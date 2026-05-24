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

const ENRICHMENT_SOURCE_SENTINEL = "__enrichment_source__";
const ENRICHMENT_ALL_SENTINEL = "__enrichment_all__";
const ENRICHMENT_FILTER_SENTINEL = "__enrichment_filter__";

export async function createEnrichmentRun(params: {
  mode: "run" | "source" | "all" | "filter";
  sourceRun?: Run;
  source?: string;
  filters?: Record<string, unknown>;
  forceRefresh: boolean;
  withHeuristic?: boolean;
  concurrency: number;
}): Promise<Run> {
  const { mode, sourceRun, source, filters, forceRefresh, withHeuristic, concurrency } = params;

  let niche: string;
  let location: string;
  let profile: DiscoveryProfile;
  let config: Record<string, unknown>;

  if (mode === "run") {
    const run = sourceRun!;
    niche = run.niche;
    location = run.location;
    profile = run.profile;
    config = {
      command: "enrich",
      mode: "run",
      source_run_id: run.id,
      force_refresh: forceRefresh,
      with_heuristic: withHeuristic === true,
      concurrency,
    };
  } else if (mode === "source") {
    niche = ENRICHMENT_SOURCE_SENTINEL;
    location = source!;
    profile = "a";
    config = {
      command: "enrich",
      mode: "source",
      source: source!,
      force_refresh: forceRefresh,
      with_heuristic: withHeuristic === true,
      concurrency,
    };
  } else if (mode === "filter") {
    niche = ENRICHMENT_FILTER_SENTINEL;
    location = ENRICHMENT_FILTER_SENTINEL;
    profile = "a";
    config = {
      command: "enrich",
      mode: "filter",
      filters: filters ?? {},
      force_refresh: forceRefresh,
      with_heuristic: withHeuristic === true,
      concurrency,
    };
  } else {
    niche = ENRICHMENT_ALL_SENTINEL;
    location = ENRICHMENT_ALL_SENTINEL;
    profile = "a";
    config = {
      command: "enrich",
      mode: "all",
      force_refresh: forceRefresh,
      with_heuristic: withHeuristic === true,
      concurrency,
    };
  }

  const { data, error } = await getSupabase()
    .from("runs")
    .insert({ niche, location, profile, config, status: "running" })
    .select()
    .single();

  if (error) throw new Error(`Failed to create enrichment run: ${error.message}`);
  return data as Run;
}

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

export async function completeScoringRun(
  runId: string,
  stats: ScoringRunStats
): Promise<void> {
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
