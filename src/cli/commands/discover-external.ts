import { readFileSync } from "fs";
import { buildProvider } from "../../modules/discovery/registry.js";
import { getDedupGeoRadiusMeters, getOnlineDedupThreshold } from "../../modules/discovery/config.js";
import { findCrossSourceMatch, isFranchise } from "../../modules/discovery/deduplication.js";
import { normalizeNiche } from "../../modules/discovery/filters.js";
import { loadAllLeads } from "../../storage/leads.js";
import { addCorroboratingSource, insertExternalLead } from "../../storage/external-leads.js";
import { loadRuntimeLists, loadAllRuntime } from "../../storage/system-lists.js";
import { normalizeCandidates } from "../../modules/discovery/candidate-normalizer.js";
import type { AllRuntime } from "../../storage/system-lists.js";
import { insertDiscoveryJob, updateDiscoveryJobStatus } from "../../storage/discovery-jobs.js";

export interface DiscoverExternalOptions {
  source: string;
  location: string;
  niche: string;
  limit?: number;
  dryRun: boolean;
  locationList?: string[];
  locationListFile?: string;
}

export interface ExternalDiscoveryExecutionSummary {
  fetched: number;
  inserted: number;
  corroborated: number;
}

function loadLocations(opts: DiscoverExternalOptions): string[] {
  if (opts.locationList && opts.locationList.length > 0) {
    return opts.locationList;
  }
  if (opts.locationListFile) {
    const raw = readFileSync(opts.locationListFile, "utf-8");
    const parsed = raw.match(/^\s*-\s+(.+)$/gm);
    if (!parsed) throw new Error(`No locations found in ${opts.locationListFile}`);
    return parsed.map((line) => line.replace(/^\s*-\s+/, "").trim());
  }
  return [opts.location];
}

async function runSingleLocation(opts: {
  source: string;
  location: string;
  niche: string;
  limit?: number;
  dryRun: boolean;
  allLeads: Awaited<ReturnType<typeof loadAllLeads>>;
  runtimeLists: Awaited<ReturnType<typeof loadRuntimeLists>>;
  nicheAliases: AllRuntime["mappings"]["nicheAliases"];
  dedupThreshold: number;
  geoRadiusMeters: number;
}): Promise<{ fetched: number; inserted: number; corroborated: number }> {
  const provider = buildProvider(opts.source);
  const normalizedNiche = normalizeNiche(opts.niche);

  let candidates = await provider.discover({ niche: normalizedNiche, location: opts.location });
  // Capa normalizadora común: reclasifica el niche con el vocabulario dinámico para TODOS los
  // sources por igual (no ad-hoc por provider), preservando el origen.
  candidates = normalizeCandidates(candidates, opts.nicheAliases);
  if (opts.limit !== undefined) {
    candidates = candidates.slice(0, opts.limit);
  }

  let inserted = 0;
  let corroborated = 0;

  for (const candidate of candidates) {
    const match = findCrossSourceMatch(candidate, opts.allLeads, opts.dedupThreshold, opts.geoRadiusMeters);
    if (match) {
      const updatedLead = await addCorroboratingSource(match.id, candidate, { dryRun: opts.dryRun });
      if (updatedLead) {
        const index = opts.allLeads.findIndex((lead) => lead.id === updatedLead.id);
        if (index >= 0) opts.allLeads[index] = updatedLead;
      }
      corroborated++;
    } else {
      const franchiseTags = isFranchise(candidate.name, opts.runtimeLists.franchiseNames)
        ? ["franchise-detected"]
        : [];
      const lead = await insertExternalLead(candidate, {
        dryRun: opts.dryRun,
        extraTags: franchiseTags,
      });
      if (lead) opts.allLeads.push(lead);
      inserted++;
    }
  }

  return { fetched: candidates.length, inserted, corroborated };
}

export async function executeExternalDiscovery(opts: {
  source: string;
  location: string;
  niche: string;
  limit?: number;
  dryRun: boolean;
}): Promise<ExternalDiscoveryExecutionSummary> {
  // Ley 18.331: excluir personas físicas del pool de dedup → un candidato nuevo no debe matchear
  // (y quedar "corroborado"/descartado) contra una persona física ya minimizada.
  const allLeads = (await loadAllLeads()).filter((l) => !l.is_natural_person);
  const runtimeLists = await loadRuntimeLists();
  const runtime = await loadAllRuntime();
  const dedupThreshold = getOnlineDedupThreshold();
  const geoRadiusMeters = getDedupGeoRadiusMeters();

  const singleOpts: Parameters<typeof runSingleLocation>[0] = {
    source: opts.source,
    location: opts.location,
    niche: opts.niche,
    dryRun: opts.dryRun,
    allLeads,
    runtimeLists,
    nicheAliases: runtime.mappings.nicheAliases,
    dedupThreshold,
    geoRadiusMeters,
  };
  if (opts.limit != null) singleOpts.limit = opts.limit;
  return runSingleLocation(singleOpts);
}

export async function discoverExternalCommand(opts: DiscoverExternalOptions): Promise<void> {
  const locations = loadLocations(opts);
  const isBatch = locations.length > 1;

  const dryLabel = opts.dryRun ? " (dry-run)" : "";

  for (const location of locations) {
    if (isBatch) {
      console.log(`\n[batch] ${opts.source} — ${location}`);
    }

    let jobId: string | null = null;
    if (!opts.dryRun) {
      try {
        const jobOpts: Parameters<typeof insertDiscoveryJob>[0] = {
          source: opts.source,
          location,
          max_results: opts.limit ?? 200,
          triggeredBy: "scheduled",
        };
        if (opts.niche) jobOpts.niche = opts.niche;
        const job = await insertDiscoveryJob(jobOpts);
        jobId = job.id;
        await updateDiscoveryJobStatus(jobId, "running");
      } catch {
        // Discovery job tracking is best-effort; continue even if DB is unavailable
      }
    }

    try {
      const result = await executeExternalDiscovery({
        source: opts.source,
        location,
        niche: opts.niche,
        dryRun: opts.dryRun,
        ...(opts.limit != null ? { limit: opts.limit } : {}),
      });

      console.log(`Discover-external [${opts.source}] — ${location}`);
      console.log(`  Fetched:      ${result.fetched}`);
      console.log(`  Inserted:     ${result.inserted}${dryLabel}`);
      console.log(`  Corroborated: ${result.corroborated}${dryLabel}`);

      if (jobId && !opts.dryRun) {
        await updateDiscoveryJobStatus(jobId, "completed", {
          leads_found: result.fetched,
          leads_new: result.inserted,
        }).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${message}`);
      if (jobId && !opts.dryRun) {
        await updateDiscoveryJobStatus(jobId, "failed", { error_message: message }).catch(() => undefined);
      }
      if (!isBatch) throw err;
    }
  }
}
