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

export async function completeRun(
  runId: string,
  counts: {
    discovered: number;
    filtered: number;
    createdNew: number;
    updatedExisting: number;
  }
): Promise<void> {
  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "completed" satisfies RunStatus,
      discovered: counts.discovered,
      filtered: counts.filtered,
      created_new: counts.createdNew,
      updated_existing: counts.updatedExisting,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    getLogger().error({ runId, error }, "Failed to complete run");
    throw new Error(`Failed to complete run: ${error.message}`);
  }
}

export async function failRun(runId: string, errMsg: string): Promise<void> {
  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "failed" satisfies RunStatus,
      error: errMsg,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    getLogger().error({ runId, error }, "Failed to mark run as failed");
  }
}
