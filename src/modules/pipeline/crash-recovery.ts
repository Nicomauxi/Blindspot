import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import type { LogLine } from "./types.js";

const logger = getLogger();

// Runs stuck in 'pending' for longer than this are considered orphaned (worker never claimed them).
const STALE_PENDING_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
// N39: un run 'running' solo se considera zombie si lleva al menos esto desde started_at.
// Abortar incondicionalmente mataba runs legítimos vivos en OTRO proceso (caso real: 6h15m
// de trabajo perdido cuando el core standalone arrancó mientras la API embebida ejecutaba).
const STALE_RUNNING_MIN_AGE_MS = 15 * 60 * 1000; // 15 min

export async function recoverOrphanedRuns(): Promise<number> {
  const supabase = getSupabase();
  let recovered = 0;

  // 1. Abort runs stuck in 'running' (worker crashed mid-execution).
  const { data: runningRows, error: runningError } = await supabase
    .from("pipeline_runs")
    .select("id, log_lines, started_at")
    .eq("status", "running");

  const cutoff = Date.now() - STALE_RUNNING_MIN_AGE_MS;
  const runningOrphans = (runningRows ?? []).filter((run) => {
    const started = typeof run.started_at === "string" ? Date.parse(run.started_at) : NaN;
    // Sin started_at parseable se asume zombie; reciente → se deja vivir.
    return !Number.isFinite(started) || started < cutoff;
  });

  if (runningError) {
    logger.error({ error: runningError }, "Failed to query orphaned running runs");
  } else if (runningOrphans.length > 0) {
    const now = new Date().toISOString();
    for (const run of runningOrphans) {
      const existing: LogLine[] = Array.isArray(run.log_lines) ? run.log_lines : [];
      const { error: updateError } = await supabase
        .from("pipeline_runs")
        .update({
          status: "aborted",
          dashboard_stale: true,
          completed_at: now,
          log_lines: [
            ...existing,
            { ts: now, msg: "startup-crash-recovery: aborted orphaned run", level: "warn" },
          ],
        })
        .eq("id", run.id)
        .eq("status", "running");

      if (updateError) {
        logger.warn({ runId: run.id, error: updateError }, "Failed to abort orphaned running run");
      } else {
        recovered++;
      }
    }
    logger.info({ count: runningOrphans.length }, "Crash recovery: orphaned running runs marked as aborted");
  }

  // 2. Abort runs stuck in 'pending' that are older than STALE_PENDING_TIMEOUT_MS
  //    (worker never started — e.g. core process was down when the run was enqueued).
  const staleCutoff = new Date(Date.now() - STALE_PENDING_TIMEOUT_MS).toISOString();
  const { data: pendingOrphans, error: pendingError } = await supabase
    .from("pipeline_runs")
    .select("id, log_lines, created_at")
    .eq("status", "pending")
    .lt("created_at", staleCutoff);

  if (pendingError) {
    logger.error({ error: pendingError }, "Failed to query stale pending runs");
  } else if (pendingOrphans && pendingOrphans.length > 0) {
    const now = new Date().toISOString();
    for (const run of pendingOrphans) {
      const existing: LogLine[] = Array.isArray(run.log_lines) ? run.log_lines : [];
      const { error: updateError } = await supabase
        .from("pipeline_runs")
        .update({
          status: "aborted",
          dashboard_stale: true,
          completed_at: now,
          log_lines: [
            ...existing,
            { ts: now, msg: "startup-crash-recovery: aborted stale pending run (worker was down)", level: "warn" },
          ],
        })
        .eq("id", run.id)
        .eq("status", "pending");

      if (updateError) {
        logger.warn({ runId: run.id, error: updateError }, "Failed to abort stale pending run");
      } else {
        recovered++;
      }
    }
    logger.info({ count: pendingOrphans.length, staleCutoff }, "Crash recovery: stale pending runs marked as aborted");
  }

  return recovered;
}

// D9: el recovery de arriba solo cubre `pipeline_runs`. Los discovery jobs viven en
// la tabla `runs` (discovery externo) y `discovery_jobs` (cola con claim CAS). Si el
// proceso muere mid-execution, quedan 'running' para siempre y dejan de ser elegibles.
// Mismo umbral de edad que N39 para no matar trabajo vivo en otro proceso.
async function recoverStaleRunningTable(
  table: "runs" | "discovery_jobs",
  failMessage: string
): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(table).select("id, started_at").eq("status", "running");

  if (error) {
    logger.error({ error, table }, "Failed to query orphaned running rows");
    return 0;
  }

  const cutoff = Date.now() - STALE_RUNNING_MIN_AGE_MS;
  const orphans = (data ?? []).filter((row) => {
    const started = typeof row.started_at === "string" ? Date.parse(row.started_at) : NaN;
    return !Number.isFinite(started) || started < cutoff;
  });

  if (orphans.length === 0) return 0;

  const now = new Date().toISOString();
  let recovered = 0;
  for (const row of orphans) {
    const update =
      table === "runs"
        ? { status: "failed", finished_at: now, stats: { error: failMessage } }
        : { status: "failed", completed_at: now, error_message: failMessage };
    const { error: updateError } = await supabase
      .from(table)
      .update(update)
      .eq("id", row.id)
      .eq("status", "running");
    if (updateError) {
      logger.warn({ table, id: row.id, error: updateError }, "Failed to recover orphaned running row");
    } else {
      recovered++;
    }
  }
  logger.info({ table, count: recovered }, "Crash recovery: orphaned running rows marked as failed");
  return recovered;
}

export async function recoverOrphanedJobs(): Promise<number> {
  const runs = await recoverStaleRunningTable("runs", "startup-crash-recovery: orphaned running run marked failed");
  const jobs = await recoverStaleRunningTable(
    "discovery_jobs",
    "startup-crash-recovery: orphaned running job marked failed"
  );
  return runs + jobs;
}

export async function appendRunLog(
  runId: string,
  msg: string,
  level: LogLine["level"] = "info"
): Promise<void> {
  const supabase = getSupabase();

  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("log_lines")
    .eq("id", runId)
    .single();

  const existing: LogLine[] = Array.isArray(run?.log_lines) ? run.log_lines : [];
  const line: LogLine = { ts: new Date().toISOString(), msg, level };

  await supabase
    .from("pipeline_runs")
    .update({ log_lines: [...existing, line] })
    .eq("id", runId);
}
