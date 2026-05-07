import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { fetchPlaceCandidates } from "../../modules/discovery/places.js";
import { applyProfileFilter, tagCandidate } from "../../modules/discovery/filters.js";
import { createRun, completeRun, failRun } from "../../storage/runs.js";
import { upsertLeads } from "../../storage/leads.js";

const DiscoverArgsSchema = z.object({
  niche: z.string().min(1, "niche cannot be empty"),
  location: z.string().min(1, "location cannot be empty"),
  profile: z.enum(["a", "b"]),
  maxResults: z.coerce.number().int().min(1).max(200).default(50),
  minRating: z.coerce.number().min(0).max(5).default(4.0),
});

export async function discoverCommand(rawArgs: {
  niche: string;
  location: string;
  profile: string;
  maxResults: string | number;
  minRating: string | number;
}): Promise<void> {
  const log = getLogger();

  const parsed = DiscoverArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }

  const opts = parsed.data;
  const startedAt = Date.now();
  log.info(opts, "Starting discover command");

  const run = await createRun(opts);
  log.info({ runId: run.id }, "Run created");

  try {
    // 1. Fetch candidates from Google Places
    const candidates = await fetchPlaceCandidates(
      opts.niche,
      opts.location,
      opts.maxResults
    );
    log.info({ discovered: candidates.length }, "Candidates fetched");

    // 2. Apply profile filter
    const filtered = applyProfileFilter(candidates, opts.profile, opts.minRating);
    log.info({ filtered: filtered.length }, "Candidates after profile filter");

    // 3. Persist to Supabase
    const { inserted, updated } = await upsertLeads(
      filtered,
      run.id,
      opts.profile,
      (c) => tagCandidate(c, opts.profile)
    );

    // 4. Close run with full stats
    const duration_ms = Date.now() - startedAt;
    await completeRun(run.id, {
      places_requests: candidates.length,
      leads_discovered: filtered.length,
      leads_new: inserted.length,
      leads_updated: updated.length,
      duration_ms,
    });

    // 5. Print summary
    printSummary(run.id, candidates.length, filtered.length, inserted.length, updated.length);
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ runId: run.id, err }, "Discover command failed");
    await failRun(run.id, msg, duration_ms);
    throw err;
  }
}

function printSummary(
  runId: string,
  discovered: number,
  filtered: number,
  createdNew: number,
  alreadyExisted: number
): void {
  console.log(`
Run ${runId} completado.
Descubiertos:      ${discovered}
Pasaron filtros:   ${filtered}
Nuevos:            ${createdNew}
Ya existían:       ${alreadyExisted}
`);
}
