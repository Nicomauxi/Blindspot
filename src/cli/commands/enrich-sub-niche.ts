// CLI command: blindspot enrich-sub-niche
// Detects sub-niches for leads with niche='other' using keyword matching or LLM.

import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import { loadLeadsBySource, loadAllPassedLeads, updateLeadCompanyData } from "../../storage/leads.js";
import { detectSubNiche } from "../../modules/enrichment/sub-niche-detection.js";
import type { Lead } from "../../shared/types.js";

const log = getLogger();

export interface EnrichSubNicheArgs {
  concurrency: number;
  dryRun: boolean;
}

export async function enrichSubNicheCommand(args: EnrichSubNicheArgs): Promise<void> {
  const { concurrency, dryRun } = args;

  const allLeads = await loadAllPassedLeads();
  const leads: Lead[] = allLeads.filter((l) => l.niche === "other");

  log.info({ total: leads.length, dryRun }, "Sub-niche detection started");

  if (leads.length === 0) {
    log.info("No leads with niche=other found — nothing to process");
    return;
  }

  const limiter = pLimit(concurrency);
  let detected = 0;
  let skipped = 0;
  let errors = 0;

  await Promise.all(
    leads.map((lead) =>
      limiter(async () => {
        try {
          const result = await detectSubNiche(lead);
          if (!result) {
            skipped++;
            return;
          }
          if (!dryRun) {
            await updateLeadCompanyData(lead.id, {
              detected_sub_niche: result.detected_sub_niche,
              sub_niche_source: result.sub_niche_source,
              sub_niche_detected_at: result.sub_niche_detected_at,
            });
          }
          detected++;
          log.debug({ leadId: lead.id, sub_niche: result.detected_sub_niche, source: result.sub_niche_source }, "sub-niche detected");
        } catch (err) {
          errors++;
          log.error({ leadId: lead.id, err }, "sub-niche detection failed");
        }
      })
    )
  );

  log.info(
    { total: leads.length, detected, skipped, errors, dryRun },
    dryRun ? "Sub-niche detection dry-run complete" : "Sub-niche detection complete"
  );
}
