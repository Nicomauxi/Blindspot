import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import {
  loadLeadsByFilterSelection,
  applyGooglePlacesRefresh,
  type EnrichmentLeadFilterSelection,
} from "../../storage/leads.js";
import { fetchPlaceSummaryForRefresh } from "../../modules/discovery/places.js";
import { createRun, completeRun, failRun } from "../../storage/runs.js";
import type { RunStats } from "../../shared/types.js";

const RE_DISCOVERY_SENTINEL = "__re_discovery__";

interface ReDiscoveryStats {
  command: "re_discover";
  total: number;
  refreshed: number;
  skipped: number;
  errors: number;
  duration_ms: number;
}

export async function startReDiscoveryJob(params: {
  filters: EnrichmentLeadFilterSelection;
  concurrency: number;
}): Promise<{ runId: string }> {
  const run = await createRun({
    niche: RE_DISCOVERY_SENTINEL,
    location: RE_DISCOVERY_SENTINEL,
    profile: "a",
    maxResults: 0,
    config: {
      command: "re_discover",
      filters: params.filters,
      concurrency: params.concurrency,
    },
  });

  void executeReDiscoveryRun(params, run.id).catch((err) => {
    getLogger().error(
      { runId: run.id, err: err instanceof Error ? err.message : String(err) },
      "Background re-discovery run failed"
    );
  });

  return { runId: run.id };
}

async function executeReDiscoveryRun(
  params: { filters: EnrichmentLeadFilterSelection; concurrency: number },
  runId: string
): Promise<void> {
  const log = getLogger();
  const startTs = Date.now();

  try {
    const leads = await loadLeadsByFilterSelection(params.filters, {
      passedOnly: false,
      limit: 1000,
    });

    const placesLeads = leads.filter(
      (l) => typeof l.place_id === "string" && l.place_id.length > 0
    );

    log.info(
      { runId, total: leads.length, with_place_id: placesLeads.length },
      "Re-discovery: loaded leads"
    );

    const limit = pLimit(Math.max(1, params.concurrency));
    let refreshed = 0;
    let skipped = 0;
    let errors = 0;

    await Promise.all(
      placesLeads.map((lead) =>
        limit(async () => {
          try {
            const summary = await fetchPlaceSummaryForRefresh(lead.place_id!);
            if (!summary) {
              skipped++;
              return;
            }
            const result = await applyGooglePlacesRefresh(lead.id, summary);
            if (result.fields_updated.length > 0) {
              refreshed++;
              log.debug(
                { leadId: lead.id, fields: result.fields_updated },
                "Re-discovery: lead updated"
              );
            } else {
              skipped++;
            }
          } catch (err) {
            errors++;
            log.error({ leadId: lead.id, err }, "Re-discovery: failed to refresh lead");
          }
        })
      )
    );

    const duration_ms = Date.now() - startTs;
    const stats: ReDiscoveryStats = {
      command: "re_discover",
      total: placesLeads.length,
      refreshed,
      skipped,
      errors,
      duration_ms,
    };
    await completeRun(runId, stats as unknown as RunStats);
    log.info({ runId, refreshed, skipped, errors, duration_ms }, "Re-discovery run completed");
  } catch (err) {
    const duration_ms = Date.now() - startTs;
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(runId, msg, duration_ms);
    throw err;
  }
}
