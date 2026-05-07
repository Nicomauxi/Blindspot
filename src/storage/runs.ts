import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { Run, DiscoveryProfile, RunStatus } from "../shared/types.js";

export async function createRun(params: {
  niche: string;
  location: string;
  profile: DiscoveryProfile;
  maxResults: number;
  minRating: number;
}): Promise<Run> {
  const { data, error } = await getSupabase()
    .from("runs")
    .insert({
      niche: params.niche,
      location: params.location,
      profile: params.profile,
      max_results: params.maxResults,
      min_rating: params.minRating,
      status: "running",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data as Run;
}

export interface RunStats {
  /** Total candidates returned by Places API text search */
  places_requests: number;
  /** Candidates that passed the profile filter */
  leads_discovered: number;
  /** New leads inserted */
  leads_new: number;
  /** Existing leads updated */
  leads_updated: number;
  /** Wall-clock duration of the full discover command */
  duration_ms: number;
}

export async function completeRun(runId: string, stats: RunStats): Promise<void> {
  const log = getLogger();

  log.info(
    { runId, duration_ms: stats.duration_ms },
    "Completing run (duration_ms logged — no DB column)"
  );

  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "completed" satisfies RunStatus,
      discovered: stats.places_requests,
      filtered: stats.leads_discovered,
      created_new: stats.leads_new,
      updated_existing: stats.leads_updated,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    log.error({ runId, error }, "Failed to complete run");
    throw new Error(`Failed to complete run: ${error.message}`);
  }
}

export async function failRun(
  runId: string,
  errMsg: string,
  duration_ms: number
): Promise<void> {
  const log = getLogger();

  log.error({ runId, duration_ms, errMsg }, "Run failed");

  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "failed" satisfies RunStatus,
      error: errMsg,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    log.error({ runId, error }, "Failed to mark run as failed");
  }
}
