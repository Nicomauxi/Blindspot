import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { Run, DiscoveryProfile, RunStatus, RunStats, ScoringRunStats } from "../shared/types.js";

export type { RunStats };

export async function createRun(params: {
  niche: string;
  location: string;
  profile: DiscoveryProfile;
  maxResults: number;
  config: Record<string, unknown>;
}): Promise<Run> {
  const { data, error } = await getSupabase()
    .from("runs")
    .insert({
      niche: params.niche,
      location: params.location,
      profile: params.profile,
      config: params.config,
      status: "running",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data as Run;
}

export async function completeRun(runId: string, stats: RunStats): Promise<void> {
  const log = getLogger();

  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "completed" satisfies RunStatus,
      stats,
      finished_at: new Date().toISOString(),
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
      stats: { duration_ms, error: errMsg },
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    log.error({ runId, error }, "Failed to mark run as failed");
  }
}

export async function getRunById(runId: string): Promise<Run | null> {
  const { data, error } = await getSupabase()
    .from("runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load run ${runId}: ${error.message}`);
  return (data as Run | null) ?? null;
}

export async function createEnrichmentRun(params: {
  sourceRun: Run;
  forceRefresh: boolean;
  withHeuristic?: boolean;
  concurrency: number;
}): Promise<Run> {
  const { sourceRun, forceRefresh, withHeuristic, concurrency } = params;
  const { data, error } = await getSupabase()
    .from("runs")
    .insert({
      niche: sourceRun.niche,
      location: sourceRun.location,
      profile: sourceRun.profile,
      config: {
        command: "enrich",
        source_run_id: sourceRun.id,
        force_refresh: forceRefresh,
        with_heuristic: withHeuristic === true,
        concurrency,
      },
      status: "running",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create enrichment run: ${error.message}`);
  return data as Run;
}

// Sentinel values used when scoring scope=all (no single source run).
// These are not real niche/location values — they mark a scoring-all run.
const SCORING_ALL_SENTINEL = "__scoring_all__";

export async function createScoringRun(params: {
  scope: "run" | "all";
  sourceRun?: Run;
  dryRun: boolean;
}): Promise<Run> {
  const { scope, sourceRun, dryRun } = params;

  const niche = sourceRun?.niche ?? SCORING_ALL_SENTINEL;
  const location = sourceRun?.location ?? SCORING_ALL_SENTINEL;
  const profile = sourceRun?.profile ?? "a";

  const { data, error } = await getSupabase()
    .from("runs")
    .insert({
      niche,
      location,
      profile,
      config: {
        command: "score",
        scope,
        ...(sourceRun ? { source_run_id: sourceRun.id } : {}),
        dry_run: dryRun,
      },
      status: "running",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create scoring run: ${error.message}`);
  return data as Run;
}

export async function completeScoringRun(runId: string, stats: ScoringRunStats): Promise<void> {
  const log = getLogger();
  const { error } = await getSupabase()
    .from("runs")
    .update({
      status: "completed" satisfies RunStatus,
      stats,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) {
    log.error({ runId, error }, "Failed to complete scoring run");
    throw new Error(`Failed to complete scoring run: ${error.message}`);
  }
}
