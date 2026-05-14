import { MINTURProvider } from "../../modules/discovery/providers/mintur.js";
import { findCrossSourceMatch } from "../../modules/discovery/deduplication.js";
import { loadAllLeads } from "../../storage/leads.js";
import { addCorroboratingSource, insertExternalLead } from "../../storage/external-leads.js";

export interface DiscoverExternalOptions {
  source: string;
  location: string;
  niche: string;
  limit?: number;
  dryRun: boolean;
}

export async function discoverExternalCommand(opts: DiscoverExternalOptions): Promise<void> {
  let provider;
  if (opts.source === "mintur") {
    provider = new MINTURProvider();
  } else {
    throw new Error(`Unknown provider source: ${opts.source}`);
  }

  let candidates = await provider.discover({ niche: opts.niche, location: opts.location });
  if (opts.limit !== undefined) {
    candidates = candidates.slice(0, opts.limit);
  }

  const allLeads = await loadAllLeads();

  let inserted = 0;
  let corroborated = 0;

  for (const candidate of candidates) {
    const match = findCrossSourceMatch(candidate, allLeads);
    if (match) {
      await addCorroboratingSource(match.id, candidate, { dryRun: opts.dryRun });
      corroborated++;
    } else {
      await insertExternalLead(candidate, { dryRun: opts.dryRun });
      inserted++;
    }
  }

  const dryLabel = opts.dryRun ? " (dry-run)" : "";
  console.log(`Discover-external [${opts.source}] — ${opts.location}`);
  console.log(`  Fetched:      ${candidates.length}`);
  console.log(`  Inserted:     ${inserted}${dryLabel}`);
  console.log(`  Corroborated: ${corroborated}${dryLabel}`);
}
