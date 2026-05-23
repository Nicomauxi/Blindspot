import { executeExternalDiscovery } from "../../cli/commands/discover-external.js";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { updateDiscoveryJobStatus } from "../../storage/discovery-jobs.js";
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
}

export interface DiscoveryQueueSummary {
  jobs_processed: number;
  leads_found: number;
  leads_new: number;
}

export async function listQueuedDiscoveryJobs(limit: number): Promise<QueuedDiscoveryJob[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("discovery_jobs")
    .select("id, source, location, niche, profile, concurrency, max_results, cost_cap_usd")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list queued discovery jobs: ${error.message}`);
  }

  return (data ?? []) as QueuedDiscoveryJob[];
}

export async function processQueuedDiscoveryJobs(limit = 1): Promise<DiscoveryQueueSummary> {
  const jobs = await listQueuedDiscoveryJobs(limit);

  let jobsProcessed = 0;
  let leadsFound = 0;
  let leadsNew = 0;

  for (const job of jobs) {
    await updateDiscoveryJobStatus(job.id, "running");

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

        await updateDiscoveryJobStatus(job.id, "completed", {
          leads_found: result.fetched,
          leads_new: result.inserted,
          estimated_cost_usd: result.estimatedCostUsd,
          actual_cost_usd: result.actualCostUsd,
          linked_run_id: result.runId,
        });

        jobsProcessed += 1;
        leadsFound += result.fetched;
        leadsNew += result.inserted;
        continue;
      }

      const result = await executeExternalDiscovery({
        source: job.source,
        location: job.location,
        niche: job.niche ?? "",
        dryRun: false,
        ...(job.max_results != null ? { limit: job.max_results } : {}),
      });

      await updateDiscoveryJobStatus(job.id, "completed", {
        leads_found: result.fetched,
        leads_new: result.inserted,
      });

      jobsProcessed += 1;
      leadsFound += result.fetched;
      leadsNew += result.inserted;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ jobId: job.id, error: message }, "Discovery job failed");
      await updateDiscoveryJobStatus(job.id, "failed", { error_message: message });
    }
  }

  return {
    jobs_processed: jobsProcessed,
    leads_found: leadsFound,
    leads_new: leadsNew,
  };
}
