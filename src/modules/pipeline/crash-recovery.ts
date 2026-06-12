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
