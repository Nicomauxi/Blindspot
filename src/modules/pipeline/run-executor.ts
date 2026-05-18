import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { appendRunLog } from "./crash-recovery.js";
import { notifyWebhook, loadWebhookConfig } from "./webhook.js";
import type { PipelineRun, PhaseResults, PhaseResult, LogLine } from "./types.js";

const logger = getLogger();

export type RunResult = { status: "completed" | "failed" | "partial"; phase_results: PhaseResults };

export async function executeRun(run: PipelineRun): Promise<RunResult> {
  const supabase = getSupabase();
  const isDryRun = run.overrides?.dry_run === true;
  const enabledPhases = run.overrides?.phases ?? ["refresh", "discovery", "enrich", "score"];

  logger.info({ runId: run.id, isDryRun, enabledPhases }, "Executing pipeline run");

  await supabase
    .from("pipeline_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", run.id);

  await appendRunLog(run.id, `Run started (dry_run=${isDryRun})`, "info");

  const phaseResults: PhaseResults = {};
  let overallStatus: "completed" | "failed" | "partial" = "completed";

  for (const phase of ["refresh", "discovery", "enrich", "score"] as const) {
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
      overallStatus = "partial";
      await appendRunLog(run.id, `Phase ${phase} failed: ${result.error ?? "unknown"}`, "error");
    }
  }

  const invariantResult = await runInvariantCheck(run.id, isDryRun);
  phaseResults.invariant_check = invariantResult;

  const finalStatus = invariantResult.status === "failed" ? "partial" : overallStatus;

  await supabase
    .from("pipeline_runs")
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      phase_results: phaseResults,
      dashboard_stale: finalStatus !== "completed",
      invariant_details: invariantResult,
    })
    .eq("id", run.id);

  await appendRunLog(run.id, `Run finished with status=${finalStatus}`, finalStatus === "completed" ? "info" : "warn");

  // Notify webhook (best-effort — don't let it fail the run)
  try {
    const webhookCfg = await loadWebhookConfig();
    await notifyWebhook(run.id, "run_completed", webhookCfg, {
      status: finalStatus,
      phase_results: phaseResults,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ runId: run.id, err: msg }, "Webhook notification error (ignored)");
  }

  logger.info({ runId: run.id, status: finalStatus }, "Run execution finished");
  return { status: finalStatus, phase_results: phaseResults };
}

async function runPhase(
  runId: string,
  phase: "refresh" | "discovery" | "enrich" | "score",
  isDryRun: boolean
): Promise<PhaseResult> {
  const startedAt = new Date().toISOString();
  await appendRunLog(runId, `Starting phase: ${phase}${isDryRun ? " (dry-run)" : ""}`, "info");

  if (isDryRun) {
    return { started_at: startedAt, completed_at: new Date().toISOString(), status: "ok", items_processed: 0 };
  }

  // In autonomous mode, phases are stubs — real execution is implemented per-phase
  // as the pipeline grows. For now, log that the phase was invoked.
  logger.info({ runId, phase }, "Phase invoked (stub — real execution pending)");
  return { started_at: startedAt, completed_at: new Date().toISOString(), status: "ok", items_processed: 0 };
}

async function runInvariantCheck(runId: string, _isDryRun: boolean): Promise<PhaseResult> {
  const startedAt = new Date().toISOString();
  await appendRunLog(runId, "Running post-run invariant check", "info");

  const supabase = getSupabase();
  const { data } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("passed_filter", true)
    .is("prospect_score", null);

  const passedSinScore = data ?? 0;
  const passed = passedSinScore === 0;

  if (!passed) {
    await appendRunLog(runId, `Invariant violated: ${passedSinScore} passed_filter leads without score`, "error");
  }

  const result: PhaseResult = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status: passed ? "ok" : "failed",
  };
  if (!passed) result.error = `passed_sin_score=${passedSinScore}`;
  return result;
}

function skippedPhase(): PhaseResult {
  const now = new Date().toISOString();
  return { started_at: now, completed_at: now, status: "skipped" };
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
