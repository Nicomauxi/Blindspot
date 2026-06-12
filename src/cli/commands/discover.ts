import { z } from "zod";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import { fetchPlaceCandidates, fetchPlaceDetails, TEXT_SEARCH_FIELDS, DETAILS_FIELDS } from "../../modules/discovery/places.js";
import { enrichWithDetails } from "../../modules/discovery/google-data-enricher.js";
import { applyProfileFilter, normalizeNiche, tagCandidate } from "../../modules/discovery/filters.js";
import { getDiscoveryConfig, getProfileConfig } from "../../modules/discovery/config.js";
import { createRun, completeRun, failRun } from "../../storage/runs.js";
import { getGooglePlacesBudgetStatus, incrementGooglePlacesBudgetSpent } from "../../storage/pipeline-config.js";
import { upsertLeads, loadAllLeads } from "../../storage/leads.js";
import { rebuildVocabularyForNiche } from "../../storage/vocabulary.js";
import { loadAllRuntime } from "../../storage/system-lists.js";
import { computeNicheStopWords } from "../../modules/enrichment/vocabulary.js";
import type { PlaceCandidate, ProfileConfig, RejectionReason } from "../../shared/types.js";
import type { RuntimeMappings } from "../../storage/system-lists.js";

// Approximate pricing per request used in trace cost estimate
import {
  TEXT_SEARCH_COST_PER_REQUEST,
  DETAILS_COST_PER_REQUEST,
  projectMaxGooglePlacesCost,
} from "../../shared/google-places-costs.js";

const DiscoverArgsSchema = z.object({
  niche: z.string().min(1, "niche cannot be empty"),
  location: z.string().min(1, "location cannot be empty"),
  profile: z.enum(["a", "b", "c", "d"]),
  maxResults: z.coerce.number().int().min(1).max(200).default(50),
  overrides: z.array(z.string()).default([]),
  trace: z.boolean().default(false),
});

function parseOverrides(raw: string[]): Partial<ProfileConfig> {
  const result: Record<string, unknown> = {};
  for (const kv of raw) {
    const eqIdx = kv.indexOf("=");
    if (eqIdx === -1) continue;
    const key = kv.slice(0, eqIdx).trim();
    const val = kv.slice(eqIdx + 1).trim();
    if (key === "min_rating") {
      result[key] = parseFloat(val);
    } else if (key === "min_reviews" || key === "max_reviews") {
      result[key] = val === "null" ? null : parseInt(val, 10);
    } else if (key === "web_requirement") {
      result[key] = val;
    }
  }
  return result as Partial<ProfileConfig>;
}

export function collectOverride(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function resolveCandidateNiche(
  normalizedRequestedNiche: string,
  candidate: PlaceCandidate,
  aliases?: RuntimeMappings["nicheAliases"]
): string {
  if (normalizedRequestedNiche !== "other") return normalizedRequestedNiche;

  const rawPrimaryType =
    typeof candidate.raw["primary_type"] === "string"
      ? candidate.raw["primary_type"]
      : typeof candidate.raw["primaryType"] === "string"
        ? candidate.raw["primaryType"]
        : null;
  const primaryType = candidate.primaryType ?? rawPrimaryType;
  if (!primaryType) return normalizedRequestedNiche;

  const normalizedPrimaryType = normalizeNiche(primaryType.replace(/_/g, " "), aliases);
  return normalizedPrimaryType === "other" ? normalizedRequestedNiche : normalizedPrimaryType;
}

function estimatePlacesCostUsd(textSearchRequestCount: number, detailsRequestCount: number): number {
  return (
    textSearchRequestCount * TEXT_SEARCH_COST_PER_REQUEST +
    detailsRequestCount * DETAILS_COST_PER_REQUEST
  );
}

interface DetailsRequestEntry {
  place_id: string;
  request: { url: string; field_mask: string };
  response:
    | { status: number; duration_ms: number; has_photos: boolean; has_hours: boolean; has_reviews: boolean }
    | { error: string; duration_ms: number };
}

interface CandidateTraceEntry {
  place_id: string;
  name: string;
  filter_decision: { passed: boolean; reasons: string[] };
  details_fetched: boolean;
  google_data_final: Record<string, unknown> | null;
}

export async function discoverCommand(rawArgs: {
  niche: string;
  location: string;
  profile: string;
  maxResults: string | number;
  override?: string[];
  trace?: boolean;
}): Promise<void> {
  const log = getLogger();

  const parsed = DiscoverArgsSchema.safeParse({
    ...rawArgs,
    overrides: rawArgs.override ?? [],
  });
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }

  const opts = parsed.data;
  const previousLevel = log.level;
  if (opts.trace) log.level = "debug";

  try {
  const runtime = await loadAllRuntime();
  const normalizedNiche = normalizeNiche(opts.niche, runtime.mappings.nicheAliases);
  const startedAt = Date.now();
  const startedAtIso = new Date().toISOString();
  log.info({ niche: opts.niche, location: opts.location, profile: opts.profile }, "Starting discover command");

  const discoveryConfig = getDiscoveryConfig();
  const rawOverrides = parseOverrides(opts.overrides);
  const profileConfig = getProfileConfig(opts.profile, rawOverrides);

  // N74: el CLI discover gastaba Google Places SIN gate de presupuesto (el gate solo
  // existía en el path de la cola). Mismo contrato: si el costo proyectado no entra en
  // el remaining, no se arranca.
  try {
    const budget = await getGooglePlacesBudgetStatus();
    if (budget) {
      const projected = projectMaxGooglePlacesCost(opts.maxResults);
      if (budget.budget_remaining <= 0 || projected > budget.budget_remaining) {
        log.error(
          { projected_usd: projected, remaining_usd: budget.budget_remaining },
          "Google Places budget gate: presupuesto insuficiente — no se ejecuta discovery"
        );
        process.exit(1);
      }
    }
  } catch (err) {
    log.error({ err }, "No se pudo leer el presupuesto GP — no se ejecuta discovery (fail-closed)");
    process.exit(1);
  }

  const run = await createRun({
    niche: opts.niche,
    location: opts.location,
    profile: opts.profile,
    maxResults: opts.maxResults,
    config: {
      max_results: opts.maxResults,
      profile_thresholds: profileConfig,
      overrides: rawOverrides,
    },
  });
  log.info({ runId: run.id }, "Run created");

  const cleanup = async (signal: string) => {
    log.warn({ runId: run.id, signal }, "Process interrupted, marking run as failed");
    try {
      await failRun(run.id, `Process interrupted (${signal})`, Date.now() - startedAt);
    } catch {
      // best effort
    }
    process.exit(1);
  };
  process.once("SIGTERM", () => void cleanup("SIGTERM"));
  process.once("SIGINT", () => void cleanup("SIGINT"));

  // Trace accumulators — only populated when --trace is active
  const detailsRequestLog: DetailsRequestEntry[] = [];
  const candidateTraceLog: CandidateTraceEntry[] = [];

  try {
    // 1. Fetch candidates from Google Places
    const { candidates, textSearchRequestCount, requestLog: textSearchLog } =
      await fetchPlaceCandidates(opts.niche, opts.location, opts.maxResults);
    log.info({ discovered: candidates.length, requests: textSearchRequestCount }, "Candidates fetched");

    if (candidates.length === 0) {
      const duration_ms = Date.now() - startedAt;
      await completeRun(run.id, {
        places_requests: textSearchRequestCount,
        estimated_cost_usd: estimatePlacesCostUsd(textSearchRequestCount, 0),
        leads_discovered: 0,
        leads_new: 0,
        leads_updated: 0,
        leads_rejected: 0,
        duration_ms,
      });
      if (opts.trace) {
        await writeTraceArtifact(run.id, {
          startedAtIso,
          opts,
          profileConfig,
          textSearchLog,
          detailsRequestLog: [],
          candidateTraceLog: [],
          passed: 0,
          rejected: 0,
          rejectionBreakdown: {},
          textSearchRequestCount,
          detailsRequestCount: 0,
        });
      }
      printSummary(run.id, 0, 0, 0, 0, 0, {});
      return;
    }

    // 2. Apply profile filter
    const { passed, rejected } = applyProfileFilter(
      candidates,
      profileConfig,
      discoveryConfig.social_domains
    );
    log.info({ passed: passed.length, rejected: rejected.length }, "Filter applied");

    // Track filter decisions for trace
    if (opts.trace) {
      for (const c of passed) {
        candidateTraceLog.push({
          place_id: c.placeId,
          name: c.name,
          filter_decision: { passed: true, reasons: [] },
          details_fetched: false,
          google_data_final: null,
        });
      }
      for (const { candidate, reasons } of rejected) {
        candidateTraceLog.push({
          place_id: candidate.placeId,
          name: candidate.name,
          filter_decision: { passed: false, reasons: reasons as string[] },
          details_fetched: false,
          google_data_final: null,
        });
      }
    }

    // 3. Fetch Place Details for passed candidates only, with concurrency limit
    const limit = pLimit(5);
    let detailsRequestCount = 0;
    const enrichedPassed: PlaceCandidate[] = await Promise.all(
      passed.map((candidate) =>
        limit(async () => {
          const startTs = Date.now();
          const details = await fetchPlaceDetails(candidate.placeId);
          detailsRequestCount++;
          const duration_ms = Date.now() - startTs;

          if (opts.trace) {
            const entry: DetailsRequestEntry = {
              place_id: candidate.placeId,
              request: {
                url: `https://places.googleapis.com/v1/places/${candidate.placeId}`,
                field_mask: DETAILS_FIELDS,
              },
              response: details
                ? {
                    status: 200,
                    duration_ms,
                    has_photos: (details.photos?.length ?? 0) > 0,
                    has_hours: (details.regularOpeningHours?.weekdayDescriptions?.length ?? 0) > 0,
                    has_reviews: (details.reviews?.length ?? 0) > 0,
                  }
                : { error: "fetch_failed_or_parse_error", duration_ms },
            };
            detailsRequestLog.push(entry);

            // Update candidate trace entry with final google_data
            const traceEntry = candidateTraceLog.find((e) => e.place_id === candidate.placeId);
            if (traceEntry) {
              traceEntry.details_fetched = true;
              traceEntry.google_data_final = details
                ? enrichWithDetails(candidate.raw, details)
                : candidate.raw;
            }
          }

          // If details failed, return original candidate without enrichment (fields remain absent)
          if (details === null) return candidate;
          return { ...candidate, raw: enrichWithDetails(candidate.raw, details) };
        })
      )
    );

    // 4. Build items array for upsert
    const passedItems = enrichedPassed.map((c) => ({
      candidate: c,
      passed: true,
      rejection_reasons: [] as string[],
      niche: resolveCandidateNiche(normalizedNiche, c, runtime.mappings.nicheAliases),
    }));
    const rejectedItems = rejected.map(({ candidate, reasons }) => ({
      candidate,
      passed: false,
      rejection_reasons: reasons as string[],
      niche: resolveCandidateNiche(normalizedNiche, candidate, runtime.mappings.nicheAliases),
    }));

    const items = discoveryConfig.persist_rejected
      ? [...passedItems, ...rejectedItems]
      : passedItems;

    // 5. Persist to Supabase
    const { inserted, updated } = await upsertLeads(
      items,
      run.id,
      opts.profile,
      (c) => tagCandidate(c, opts.profile, discoveryConfig.social_domains)
    );

    // 6. Build rejection reason breakdown
    const reasonBreakdown: Record<string, number> = {};
    for (const { reasons } of rejected) {
      for (const reason of reasons) {
        reasonBreakdown[reason] = (reasonBreakdown[reason] ?? 0) + 1;
      }
    }

    // 7. Close run with correct HTTP request count (not candidate count)
    const duration_ms = Date.now() - startedAt;
    const runCostUsd = estimatePlacesCostUsd(textSearchRequestCount, detailsRequestCount);
    await completeRun(run.id, {
      places_requests: textSearchRequestCount + detailsRequestCount,
      estimated_cost_usd: runCostUsd,
      leads_discovered: passed.length,
      leads_new: inserted.filter((l) => l.passed_filter).length,
      leads_updated: updated.filter((l) => l.passed_filter).length,
      leads_rejected: rejected.length,
      duration_ms,
    });
    // N74: el registro del gasto es parte del contrato de presupuesto — awaiteado y
    // con error visible (antes era fire-and-forget con catch vacío).
    try {
      await incrementGooglePlacesBudgetSpent(runCostUsd);
    } catch (err) {
      log.error({ err, runId: run.id, cost_usd: runCostUsd }, "No se pudo registrar el gasto GP (usar gp-budget/backfill)");
    }

    // 8. Best-effort vocabulary rebuild using ALL leads for the niche (GAP 3).
    //    Uses loadAllLeads so frequencies are computed from the full corpus,
    //    not just the leads discovered in this run.
    if (normalizedNiche && normalizedNiche !== "all") {
      try {
        const allLeads = await loadAllLeads();
        const nicheLeads = allLeads.filter((l) => l.niche === normalizedNiche);
        const wordCounts = computeNicheStopWords(nicheLeads, 3, 0.05);
        await rebuildVocabularyForNiche(normalizedNiche, wordCounts);
        log.info({ niche: normalizedNiche, words: wordCounts.size, corpus: nicheLeads.length }, "vocabulary rebuilt post-discover");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ niche: normalizedNiche, err: msg }, "vocabulary rebuild failed post-discover — skipping");
      }
    }

    // 9. Write trace artifact if --trace
    if (opts.trace) {
      await writeTraceArtifact(run.id, {
        startedAtIso,
        opts,
        profileConfig,
        textSearchLog,
        detailsRequestLog,
        candidateTraceLog,
        passed: passed.length,
        rejected: rejected.length,
        rejectionBreakdown: reasonBreakdown,
        textSearchRequestCount,
        detailsRequestCount,
      });
    }

    // 10. Print summary
    printSummary(
      run.id,
      candidates.length,
      passed.length,
      inserted.filter((l) => l.passed_filter).length,
      updated.filter((l) => l.passed_filter).length,
      rejected.length,
      reasonBreakdown
    );
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ runId: run.id, err }, "Discover command failed");
    await failRun(run.id, msg, duration_ms);
    throw err;
  }
  } finally {
    if (opts.trace) log.level = previousLevel;
  }
}

async function writeTraceArtifact(
  runId: string,
  data: {
    startedAtIso: string;
    opts: z.infer<typeof DiscoverArgsSchema>;
    profileConfig: ProfileConfig;
    textSearchLog: Array<{
      request: { query: string; field_mask: string; page_size: number; page_token: string | null };
      response: { place_count: number; next_page_token: string | null; duration_ms: number };
    }>;
    detailsRequestLog: DetailsRequestEntry[];
    candidateTraceLog: CandidateTraceEntry[];
    passed: number;
    rejected: number;
    rejectionBreakdown: Record<string, number>;
    textSearchRequestCount: number;
    detailsRequestCount: number;
  }
): Promise<void> {
  const log = getLogger();
  const finishedAt = new Date().toISOString();
  const dir = join("reports", runId);

  const trace = {
    run_id: runId,
    command: "discover",
    started_at: data.startedAtIso,
    finished_at: finishedAt,
    args: {
      niche: data.opts.niche,
      location: data.opts.location,
      profile: data.opts.profile,
      max_results: data.opts.maxResults,
      overrides: data.opts.overrides,
    },
    config_snapshot: data.profileConfig,
    places_text_search_requests: data.textSearchLog,
    places_details_requests: data.detailsRequestLog,
    candidates: data.candidateTraceLog,
    summary: {
      text_search_requests_total: data.textSearchRequestCount,
      details_requests_total: data.detailsRequestCount,
      candidates_received: data.candidateTraceLog.length,
      passed: data.passed,
      rejected: data.rejected,
      rejection_breakdown: data.rejectionBreakdown,
      estimated_cost_usd: estimatePlacesCostUsd(data.textSearchRequestCount, data.detailsRequestCount),
    },
  };

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "run-trace.json"), JSON.stringify(trace, null, 2));
    log.info({ path: join(dir, "run-trace.json") }, "Trace artifact written");
  } catch (err) {
    log.error({ err }, "Failed to write trace artifact");
  }
}

function printSummary(
  runId: string,
  discovered: number,
  filtered: number,
  createdNew: number,
  alreadyExisted: number,
  rejected: number,
  reasonBreakdown: Record<string, number>
): void {
  const lines: string[] = [
    ``,
    `Run ${runId} completado.`,
    `Descubiertos:      ${discovered}`,
    `Aceptados:         ${filtered}`,
    `Nuevos:            ${createdNew}`,
    `Ya existían:       ${alreadyExisted}`,
    `Rechazados:        ${rejected}`,
  ];

  if (rejected > 0 && Object.keys(reasonBreakdown).length > 0) {
    lines.push(``);
    lines.push(`Motivos de rechazo (por aparición):`);
    const totalReasons = Object.values(reasonBreakdown).reduce((a, b) => a + b, 0);
    for (const [reason, count] of Object.entries(reasonBreakdown).sort(([, a], [, b]) => b - a)) {
      lines.push(`  ${reason}: ${count}`);
    }
    if (totalReasons > rejected) {
      lines.push(`  (total razones: ${totalReasons} — algunos leads tienen múltiples motivos)`);
    }
  }

  lines.push(``);
  console.log(lines.join("\n"));
}
