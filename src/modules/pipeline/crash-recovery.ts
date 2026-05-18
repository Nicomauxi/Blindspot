import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import type { LogLine } from "./types.js";

const logger = getLogger();

export async function recoverOrphanedRuns(): Promise<number> {
  const supabase = getSupabase();

  const { data: orphans, error } = await supabase
    .from("pipeline_runs")
    .select("id, log_lines")
    .eq("status", "running");

  if (error) {
    logger.error({ error }, "Failed to query orphaned runs");
    return 0;
  }

  if (!orphans || orphans.length === 0) return 0;

  const now = new Date().toISOString();

  for (const run of orphans) {
    const existing: LogLine[] = Array.isArray(run.log_lines) ? run.log_lines : [];
    const updatedLines: LogLine[] = [
      ...existing,
      { ts: now, msg: "startup-crash-recovery: aborted orphaned run", level: "warn" },
    ];

    const { error: updateError } = await supabase
      .from("pipeline_runs")
      .update({
        status: "aborted",
        dashboard_stale: true,
        completed_at: now,
        log_lines: updatedLines,
      })
      .eq("id", run.id)
      .eq("status", "running");

    if (updateError) {
      logger.warn({ runId: run.id, error: updateError }, "Failed to abort orphaned run");
    }
  }

  logger.info({ count: orphans.length }, "Crash recovery: orphaned runs marked as aborted");
  return orphans.length;
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
