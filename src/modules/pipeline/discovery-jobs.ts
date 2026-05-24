import pLimit from "p-limit";
import { enrichCommand } from "../../cli/commands/enrich.js";
import { executeExternalDiscovery } from "../../cli/commands/discover-external.js";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { createRun, completeRun, failRun } from "../../storage/runs.js";
import { updateDiscoveryJobEnrichmentStatus, updateDiscoveryJobStatus } from "../../storage/discovery-jobs.js";
import { executeGooglePlacesDiscoveryJob } from "./google-places-discovery-job.js";

const logger = getLogger();

interface QueuedDiscoveryJob {
  id: string;
  source: string;
  location: string;
  niche: string | null;
  profile: string | null;
  concurrency: number | null;
  max_results: number | null;
  cost_cap_usd: number | null;
  cpu_budget: string | null;
  enrich_after_discovery: boolean | null;
}

export interface DiscoveryQueueSummary {
  jobs_processed: number;
  leads_found: number;
  leads_new: number;
}

function discoveryProfile(profile: string | null | undefined): "a" | "b" | "c" | "d" {
  const normalized = profile?.toLowerCase();
  return normalized === "a" || normalized === "b" || normalized === "c" || normalized === "d" ? normalized : "a";
}

function enrichConcurrency(cpuBudget: string | null | undefined): string {
  if (cpuBudget === "aggressive") return "6";
  if (cpuBudget === "conservative") return "2";
  return "4";
}

async function runFollowupEnrichment(job: QueuedDiscoveryJob, sourceRunId: string): Promise<void> {
  if (!job.enrich_after_discovery) {
    await updateDiscoveryJobEnrichmentStatus(job.id, "skipped");
    return;
  }

  await updateDiscoveryJobEnrichmentStatus(job.id, "running");
  try {
    const result = await enrichCommand({
      run: sourceRunId,
      forceRefresh: false,
      withHeuristic: true,
      concurrency: enrichConcurrency(job.cpu_budget),
      all: false,
    });
    await updateDiscoveryJobEnrichmentStatus(job.id, "completed", { linked_enrich_run_id: result.runId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId: job.id, sourceRunId, error: message }, "Discovery follow-up enrichment failed");
    await updateDiscoveryJobEnrichmentStatus(job.id, "failed", { enrich_error_message: message });
  }
}

export async function listQueuedDiscoveryJobs(limit: number): Promise<QueuedDiscoveryJob[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("discovery_jobs")
    .select("id, source, location, niche, profile, concurrency, max_results, cost_cap_usd, cpu_budget, enrich_after_discovery")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list queued discovery jobs: ${error.message}`);
  }

  return (data ?? []) as QueuedDiscoveryJob[];
}

async function executeDiscoveryJob(job: QueuedDiscoveryJob): Promise<{ leadsFound: number; leadsNew: number }> {
  await updateDiscoveryJobStatus(job.id, "running");

  let externalRunId: string | null = null;
  let externalRunStartedAt = 0;

  try {
    if (job.source === "google_places") {
      if (!(job.cost_cap_usd && job.cost_cap_usd > 0)) {
        throw new Error("Google Places discovery job requires cost_cap_usd");
      }

      const result = await executeGooglePlacesDiscoveryJob({
        location: job.location,
        niche: job.niche,
        profile: job.profile,
        maxResults: job.max_results,
        concurrency: job.concurrency,
        costCapUsd: job.cost_cap_usd,
      });

      if (result.budgetAborted) {
        logger.warn({ jobId: job.id, actualCostUsd: result.actualCostUsd }, "Discovery job completed with budget abort — detail requests halted mid-execution");
      }

      await updateDiscoveryJobStatus(job.id, "completed", {
        leads_found: result.fetched,
        leads_new: result.inserted,
        estimated_cost_usd: result.estimatedCostUsd,
        actual_cost_usd: result.actualCostUsd,
        linked_run_id: result.runId,
        ...(result.budgetAborted ? { error_message: "Budget cap reached mid-execution — partial results saved" } : {}),
      });
      await runFollowupEnrichment(job, result.runId);

      return { leadsFound: result.fetched, leadsNew: result.inserted };
    }

    externalRunStartedAt = Date.now();
    const run = await createRun({
      niche: job.niche ?? "other",
      location: job.location,
      profile: discoveryProfile(job.profile),
      maxResults: job.max_results ?? 200,
      config: {
        command: "discover-external",
        source: job.source,
        batch_job_id: job.id,
        enrich_after_discovery: job.enrich_after_discovery === true,
      },
    });
    externalRunId = run.id;

    const result = await executeExternalDiscovery({
      source: job.source,
      location: job.location,
      niche: job.niche ?? "",
      dryRun: false,
      ...(job.max_results != null ? { limit: job.max_results } : {}),
    });

    await completeRun(run.id, {
      places_requests: 0,
      estimated_cost_usd: 0,
      leads_discovered: result.fetched,
      leads_new: result.inserted,
      leads_updated: result.corroborated,
      duration_ms: Date.now() - externalRunStartedAt,
    });

    await updateDiscoveryJobStatus(job.id, "completed", {
      leads_found: result.fetched,
      leads_new: result.inserted,
      linked_run_id: run.id,
    });
    await runFollowupEnrichment(job, run.id);

    return { leadsFound: result.fetched, leadsNew: result.inserted };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId: job.id, error: message }, "Discovery job failed");
    if (externalRunId) {
      await failRun(externalRunId, message, Math.max(1, Date.now() - externalRunStartedAt)).catch(() => undefined);
    }
    await updateDiscoveryJobStatus(job.id, "failed", { error_message: message });
    if (job.enrich_after_discovery) {
      await updateDiscoveryJobEnrichmentStatus(job.id, "failed", { enrich_error_message: "Discovery failed before enrichment could start" }).catch(() => undefined);
    }
    return { leadsFound: 0, leadsNew: 0 };
  }
}

export async function processQueuedDiscoveryJobs(concurrency = 1): Promise<DiscoveryQueueSummary> {
  const jobs = await listQueuedDiscoveryJobs(concurrency);

  if (jobs.length === 0) {
    return { jobs_processed: 0, leads_found: 0, leads_new: 0 };
  }

  const limit = pLimit(concurrency);
  const results = await Promise.all(
    jobs.map((job) => limit(() => executeDiscoveryJob(job)))
  );

  return {
    jobs_processed: results.length,
    leads_found: results.reduce((s, r) => s + r.leadsFound, 0),
    leads_new: results.reduce((s, r) => s + r.leadsNew, 0),
  };
}
