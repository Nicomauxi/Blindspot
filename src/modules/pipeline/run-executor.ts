import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { appendRunLog } from "./crash-recovery.js";
import { notifyWebhook, loadWebhookConfig } from "./webhook.js";
import {
  executeDiscoveryPhase,
  executeEnrichPhase,
  executeRefreshPhase,
  executeScorePhase,
} from "./phase-executors.js";
import type { PipelineRun, PhaseResults, PhaseResult, LogLine } from "./types.js";

const logger = getLogger();

export type RunResult = { status: "completed" | "failed" | "partial" | "aborted"; phase_results: PhaseResults };

export async function executeRun(run: PipelineRun): Promise<RunResult> {
  const supabase = getSupabase();
  const isDryRun = run.overrides?.dry_run === true;
  const enabledPhases = run.overrides?.phases ?? ["refresh", "discovery", "enrich", "score"];

  logger.info({ runId: run.id, isDryRun, enabledPhases }, "Executing pipeline run");

  // The scheduler does an atomic claim (pending → running) before calling
  // executeRun, so this UPDATE is a no-op for the scheduler path. We keep it
  // (idempotent) for the CLI / manual paths that pass a pending run directly.
  const { error: startError } = await supabase
    .from("pipeline_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      config_snapshot: run.config_snapshot ?? null,
    })
    .eq("id", run.id);
  if (startError) {
    throw new Error(`Failed to mark run as running: ${startError.message}`);
  }

  await appendRunLog(run.id, `Run started (dry_run=${isDryRun})`, "info");

  const phaseResults: PhaseResults = {};
  let hadFailure = false;
  let hadSuccess = false;

  for (const phase of ["refresh", "discovery", "enrich", "score"] as const) {
    if (await isAbortRequested(run.id)) {
      await appendRunLog(run.id, `Abort requested before phase ${phase}`, "warn");
      return finalizeRun(run.id, "aborted", phaseResults);
    }

    if (!enabledPhases.includes(phase)) {
      phaseResults[phase] = skippedPhase();
      continue;
    }

    const config = run.config_snapshot?.phases?.[phase];
    if (config && "enabled" in config && !config.enabled) {
      phaseResults[phase] = skippedPhase();
      continue;
    }

    const result = await runPhase(run.id, phase, isDryRun);
    phaseResults[phase] = result;

    if (result.status === "failed") {
      hadFailure = true;
      await appendRunLog(run.id, `Phase ${phase} failed: ${result.error ?? "unknown"}`, "error");
      continue;
    }

    if (result.status === "ok") {
      hadSuccess = true;
    }

    if (await isAbortRequested(run.id)) {
      await appendRunLog(run.id, `Abort requested after phase ${phase}`, "warn");
      return finalizeRun(run.id, "aborted", phaseResults);
    }
  }

  const invariantResult = await runInvariantCheck(run.id, isDryRun);
  phaseResults.invariant_check = invariantResult;

  if (invariantResult.status === "failed") {
    hadFailure = true;
  } else if (invariantResult.status === "ok") {
    hadSuccess = true;
  }

  const finalStatus = hadFailure ? (hadSuccess ? "partial" : "failed") : "completed";

  return finalizeRun(run.id, finalStatus, phaseResults);
}

async function finalizeRun(
  runId: string,
  status: "completed" | "failed" | "partial" | "aborted",
  phaseResults: PhaseResults
): Promise<RunResult> {
  const supabase = getSupabase();
  // N42: CAS running→terminal. Sin el guard, un executor zombie resucitaba runs ya
  // marcados 'aborted' por crash-recovery escribiéndoles 'completed' encima.
  const { data: finalized, error: finalizeError } = await supabase
    .from("pipeline_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      phase_results: phaseResults,
      dashboard_stale: status !== "completed",
      invariant_details: phaseResults.invariant_check ?? null,
    })
    .eq("id", runId)
    .eq("status", "running")
    .select("id");

  if (finalizeError || !finalized || finalized.length === 0) {
    logger.warn(
      { runId, intendedStatus: status, error: finalizeError?.message ?? null },
      "finalizeRun: el run ya no estaba 'running' (abortado/finalizado por otro proceso) — no se sobrescribe ni se notifica"
    );
    return { status: "aborted", phase_results: phaseResults };
  }

  await appendRunLog(runId, `Run finished with status=${status}`, status === "completed" ? "info" : "warn");

  // Notify webhook (best-effort — don't let it fail the run)
  try {
    const webhookCfg = await loadWebhookConfig();
    await notifyWebhook(runId, "run_completed", webhookCfg, {
      status,
      phase_results: phaseResults,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ runId, err: msg }, "Webhook notification error (ignored)");
  }

  logger.info({ runId, status }, "Run execution finished");
  return { status, phase_results: phaseResults };
}

async function runPhase(
  runId: string,
  phase: "refresh" | "discovery" | "enrich" | "score",
  isDryRun: boolean
): Promise<PhaseResult> {
  const startedAt = new Date().toISOString();
  await appendRunLog(runId, `Starting phase: ${phase}${isDryRun ? " (dry-run)" : ""}`, "info");

  try {
    const supabase = getSupabase();
    const { data: runRow, error } = await supabase
      .from("pipeline_runs")
      .select("config_snapshot")
      .eq("id", runId)
      .single();

    if (error || !runRow) {
      throw new Error(`Failed to load config snapshot for run ${runId}`);
    }

    const configSnapshot = (runRow as Pick<PipelineRun, "config_snapshot">).config_snapshot;
    if (!configSnapshot) {
      throw new Error("Missing config_snapshot");
    }

    const summary = phase === "refresh"
      ? await executeRefreshPhase(configSnapshot.phases.refresh, isDryRun)
      : phase === "discovery"
      ? await executeDiscoveryPhase(configSnapshot.phases.discovery, isDryRun)
      : phase === "enrich"
      ? await executeEnrichPhase(configSnapshot.phases.enrich, isDryRun)
      : await executeScorePhase(configSnapshot.phases.score, isDryRun);

    if (summary.note) {
      await appendRunLog(runId, `Phase ${phase}: ${summary.note}`, "info");
    }

    // N43: una fase con >5% de fallos no es 'ok' — antes las fases reportaban ok
    // desacopladas del resultado real (run 55b3bcd9: 4 fases ok, 1317 sin score).
    const failedItems = summary.failedItems ?? 0;
    const totalItems = summary.itemsProcessed + failedItems;
    const failureRatio = totalItems > 0 ? failedItems / totalItems : 0;
    if (failureRatio > 0.05) {
      await appendRunLog(runId, `Phase ${phase}: ${failedItems}/${totalItems} items failed`, "error");
      return {
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        status: "failed",
        items_processed: summary.itemsProcessed,
        error: `failed_items=${failedItems}/${totalItems}`,
      };
    }
    return {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "ok",
      items_processed: summary.itemsProcessed,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ runId, phase, error: message }, "Pipeline phase failed");
    return {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      error: message,
    };
  }
}

async function runInvariantCheck(runId: string, _isDryRun: boolean): Promise<PhaseResult> {
  const startedAt = new Date().toISOString();
  await appendRunLog(runId, "Running post-run invariant check", "info");

  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("passed_filter", true)
    .is("prospect_score", null);

  if (error) {
    return {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      error: error.message,
    };
  }

  const passedSinScore = count ?? 0;
  const passed = passedSinScore === 0;

  if (!passed) {
    await appendRunLog(runId, `Invariant violated: ${passedSinScore} passed_filter leads without score`, "error");
  }

  // N18/N37: re-validar el stock geo en cada run (el gate solo corre at-insert; sin esto
  // cualquier endurecimiento futuro deja cohortes grandfathered indetectables). Solo
  // warning — la limpieza es una decisión de datos, no un fallo del run.
  let geoViolations: number | null = null;
  try {
    const { data: geoCount, error: geoError } = await supabase.rpc("count_pool_geo_violations");
    if (!geoError && typeof geoCount === "number") {
      geoViolations = geoCount;
      if (geoCount > 0) {
        await appendRunLog(runId, `Invariant warning: ${geoCount} pool leads with GPS outside Uruguay bbox`, "warn");
      }
    }
  } catch {
    // RPC ausente (migración no aplicada) → se omite el invariante geo.
  }

  const result: PhaseResult = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status: passed ? "ok" : "failed",
  };
  if (!passed) result.error = `passed_sin_score=${passedSinScore}`;
  if (geoViolations != null && geoViolations > 0) {
    result.error = [result.error, `pool_geo_violations=${geoViolations}`].filter(Boolean).join("; ");
  }
  return result;
}

function skippedPhase(): PhaseResult {
  const now = new Date().toISOString();
  return { started_at: now, completed_at: now, status: "skipped" };
}

async function isAbortRequested(runId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("abort_requested")
    .eq("id", runId)
    .single();

  if (error) {
    logger.warn({ runId, error }, "Failed to check abort_requested");
    return false;
  }

  return (data as { abort_requested?: boolean } | null)?.abort_requested === true;
}

export async function transitionToPending(
  triggeredBy: PipelineRun["triggered_by"],
  overrides?: PipelineRun["overrides"]
): Promise<string> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "pending",
      triggered_by: triggeredBy,
      overrides: overrides ?? null,
      log_lines: [
        { ts: new Date().toISOString(), msg: `Run queued (triggered_by=${triggeredBy})`, level: "info" } as LogLine,
      ],
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to insert pipeline_run: ${error?.message}`);
  return data.id;
}
