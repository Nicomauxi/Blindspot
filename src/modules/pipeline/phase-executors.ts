import { enrichCommand } from "../../cli/commands/enrich.js";
import { hasStaleLeadsForSource, queryStaleRuns } from "../../cli/commands/maintenance.js";
import { scoreCommand } from "../../cli/commands/score.js";
import { getSourceRefreshDays } from "../discovery/config.js";
import { listQueuedDiscoveryJobs, processQueuedDiscoveryJobs } from "./discovery-jobs.js";
import { getSupabase } from "../../shared/supabase.js";
import type { PipelineConfig } from "./types.js";

interface PhaseExecutionSummary {
  itemsProcessed: number;
  note?: string;
}

interface RefreshPlan {
  staleRunIds: string[];
  staleExternalSources: string[];
}

async function buildRefreshPlan(
  config: PipelineConfig["phases"]["refresh"]
): Promise<RefreshPlan> {
  const configuredSources = new Set(config.sources);
  const staleRunIds = configuredSources.has("google_places")
    ? (await queryStaleRuns(getSourceRefreshDays("google_places"))).map((entry) => entry.runId)
    : [];

  const staleExternalSources: string[] = [];
  for (const source of config.sources) {
    if (source === "google_places") continue;
    if (await hasStaleLeadsForSource(source, getSourceRefreshDays(source))) {
      staleExternalSources.push(source);
    }
  }

  return { staleRunIds, staleExternalSources };
}

async function countRows(table: string, filters: Array<[string, unknown]> = []): Promise<number> {
  let query = getSupabase().from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

export async function executeRefreshPhase(
  config: PipelineConfig["phases"]["refresh"],
  isDryRun: boolean
): Promise<PhaseExecutionSummary> {
  const plan = await buildRefreshPlan(config);
  const itemsProcessed = plan.staleRunIds.length + plan.staleExternalSources.length;

  if (isDryRun) {
    return {
      itemsProcessed,
      note: `google_places_runs=${plan.staleRunIds.length}, external_sources=${plan.staleExternalSources.length}`,
    };
  }

  for (const runId of plan.staleRunIds) {
    await enrichCommand({
      run: runId,
      forceRefresh: false,
      withHeuristic: true,
      concurrency: "5",
      all: false,
    });
  }

  for (const source of plan.staleExternalSources) {
    await enrichCommand({
      source,
      forceRefresh: false,
      withHeuristic: false,
      concurrency: "5",
      all: false,
    });
  }

  return { itemsProcessed };
}

export async function executeDiscoveryPhase(
  config: PipelineConfig["phases"]["discovery"],
  isDryRun: boolean
): Promise<PhaseExecutionSummary> {
  if (isDryRun) {
    const queued = await listQueuedDiscoveryJobs(config.max_jobs);
    return { itemsProcessed: queued.length };
  }

  const result = await processQueuedDiscoveryJobs(config.max_jobs);
  return {
    itemsProcessed: result.jobs_processed,
    note: `leads_found=${result.leads_found}, leads_new=${result.leads_new}`,
  };
}

export async function executeEnrichPhase(
  config: PipelineConfig["phases"]["enrich"],
  isDryRun: boolean
): Promise<PhaseExecutionSummary> {
  const itemsProcessed = await countRows("leads", [["passed_filter", true]]);

  if (isDryRun) {
    return { itemsProcessed };
  }

  await enrichCommand({
    all: true,
    forceRefresh: false,
    withHeuristic: config.with_heuristic,
    concurrency: String(config.concurrency),
  });

  return { itemsProcessed };
}

export async function executeScorePhase(
  _config: PipelineConfig["phases"]["score"],
  isDryRun: boolean
): Promise<PhaseExecutionSummary> {
  const itemsProcessed = await countRows("leads");

  if (isDryRun) {
    return { itemsProcessed };
  }

  await scoreCommand({
    all: true,
    dryRun: false,
  });

  return { itemsProcessed };
}
