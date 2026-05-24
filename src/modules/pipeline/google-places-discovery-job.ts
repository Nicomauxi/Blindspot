import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import { fetchPlaceCandidates, fetchPlaceDetails } from "../discovery/places.js";
import { enrichWithDetails } from "../discovery/google-data-enricher.js";
import { applyProfileFilter, normalizeNiche, tagCandidate } from "../discovery/filters.js";
import { getDiscoveryConfig, getProfileConfig } from "../discovery/config.js";
import { createRun, completeRun, failRun } from "../../storage/runs.js";
import { incrementGooglePlacesBudgetSpent, getGooglePlacesBudgetStatus } from "../../storage/pipeline-config.js";
import { upsertLeads, loadLeadsByNiche } from "../../storage/leads.js";
import { rebuildVocabularyForNiche } from "../../storage/vocabulary.js";
import { loadAllRuntime } from "../../storage/system-lists.js";
import { computeNicheStopWords } from "../enrichment/vocabulary.js";
import { getSupabase } from "../../shared/supabase.js";
import { createAlert } from "../../storage/alerts.js";
import type { PlaceCandidate } from "../../shared/types.js";

const logger = getLogger();

const TEXT_SEARCH_COST_PER_REQUEST = 0.035;
const DETAILS_COST_PER_REQUEST = 0.025;

function estimateActualCostUsd(textSearchRequestCount: number, detailsRequestCount: number): number {
  return textSearchRequestCount * TEXT_SEARCH_COST_PER_REQUEST + detailsRequestCount * DETAILS_COST_PER_REQUEST;
}

export function estimateGooglePlacesCostUsd(maxResults: number): number {
  const safeMaxResults = Math.max(1, Math.min(1000, maxResults));
  return Math.ceil(safeMaxResults / 20) * TEXT_SEARCH_COST_PER_REQUEST + safeMaxResults * DETAILS_COST_PER_REQUEST;
}

function resolveCandidateNiche(
  normalizedRequestedNiche: string,
  candidate: PlaceCandidate,
  aliases?: readonly { niche: string; term: string; matchType: string }[]
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

const COVERAGE_LOOKBACK_DAYS = 30;

export async function checkRecentCoverage(
  location: string,
  niche: string,
  maxResults: number,
  thresholdRatio = 0.8
): Promise<{ should_skip: boolean; recent_count: number }> {
  const cutoff = new Date(Date.now() - COVERAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await getSupabase()
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("source", "google_places")
    .ilike("location", `%${location}%`)
    .eq("niche", niche)
    .gte("created_at", cutoff)
    .eq("passed_filter", true);

  if (error) {
    logger.warn({ error, location, niche }, "checkRecentCoverage query failed — proceeding with job");
    return { should_skip: false, recent_count: 0 };
  }

  const recent_count = count ?? 0;
  const should_skip = recent_count >= Math.floor(maxResults * thresholdRatio);
  return { should_skip, recent_count };
}

export interface GooglePlacesDiscoveryJobResult {
  runId: string;
  fetched: number;
  passed: number;
  inserted: number;
  updated: number;
  rejected: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  budgetAborted: boolean;
}

export async function executeGooglePlacesDiscoveryJob(opts: {
  location: string;
  niche?: string | null;
  profile?: string | null;
  maxResults?: number | null;
  concurrency?: number | null;
  costCapUsd: number;
  skipCoverageCheck?: boolean;
}): Promise<GooglePlacesDiscoveryJobResult> {
  const requestedNiche = (opts.niche ?? "").trim() || "negocios";
  const maxResults = Math.max(1, Math.min(opts.maxResults ?? 50, 200));
  const profileKey = (opts.profile ?? "B").toLowerCase() as "a" | "b" | "c" | "d";
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 10));
  const conservativeEstimate = estimateGooglePlacesCostUsd(maxResults);
  const budget = await getGooglePlacesBudgetStatus();
  const runtimeCap = Math.min(opts.costCapUsd, budget?.budget_remaining ?? opts.costCapUsd);

  if (!(runtimeCap > 0)) {
    throw new Error("Google Places budget exhausted for current month");
  }

  if (conservativeEstimate > runtimeCap) {
    throw new Error(`Google Places estimated cost USD ${conservativeEstimate.toFixed(2)} exceeds allowed cap USD ${runtimeCap.toFixed(2)}`);
  }

  if (!opts.skipCoverageCheck) {
    const coverage = await checkRecentCoverage(opts.location, requestedNiche, maxResults);
    if (coverage.should_skip) {
      logger.info(
        { location: opts.location, niche: requestedNiche, recent_count: coverage.recent_count, maxResults },
        "Coverage pre-check: location/niche already well-covered — skipping job"
      );
      throw new Error(`Coverage pre-check: ${coverage.recent_count} recent leads already found for ${requestedNiche} in ${opts.location} (threshold: ${Math.floor(maxResults * 0.8)}). Pass skipCoverageCheck=true to override.`);
    }
  }

  const runtime = await loadAllRuntime();
  const normalizedNiche = normalizeNiche(requestedNiche, runtime.mappings.nicheAliases);
  const discoveryConfig = getDiscoveryConfig();
  const profileConfig = getProfileConfig(profileKey, {});
  const startedAt = Date.now();

  const run = await createRun({
    niche: requestedNiche,
    location: opts.location,
    profile: profileKey,
    maxResults,
    config: {
      command: "discovery_job_google_places",
      max_results: maxResults,
      profile_thresholds: profileConfig,
      concurrency,
      cost_cap_usd: opts.costCapUsd,
      budget_remaining_usd: budget?.budget_remaining ?? null,
    },
  });

  try {
    const { candidates, textSearchRequestCount } = await fetchPlaceCandidates(
      requestedNiche,
      opts.location,
      maxResults,
      { minRating: profileConfig.min_rating, minReviews: profileConfig.min_reviews, earlyStop: true }
    );
    const { passed, rejected } = applyProfileFilter(candidates, profileConfig, discoveryConfig.social_domains);

    const limit = pLimit(concurrency);
    let detailsRequestCount = 0;
    let budgetAborted = false;
    const textSearchCostSoFar = textSearchRequestCount * TEXT_SEARCH_COST_PER_REQUEST;

    const enrichedPassed: PlaceCandidate[] = await Promise.all(
      passed.map((candidate) =>
        limit(async () => {
          // Early exit: another concurrent task already tripped the budget cap.
          if (budgetAborted) return candidate;

          // Reserve the request slot BEFORE awaiting fetchPlaceDetails so the
          // cost accounting reflects the request we are about to make. V8 is
          // single-threaded so this increment is atomic relative to the cap
          // check below — the previous order let multiple callbacks all see
          // the pre-increment count and over-spend.
          detailsRequestCount += 1;
          const runningCost = textSearchCostSoFar + detailsRequestCount * DETAILS_COST_PER_REQUEST;
          if (runningCost >= runtimeCap) {
            if (!budgetAborted) {
              budgetAborted = true;
              logger.warn({ runningCost, runtimeCap }, "Google Places budget cap reached mid-execution — halting remaining detail requests");
            }
          }

          const details = await fetchPlaceDetails(candidate.placeId);
          if (details === null) return candidate;
          return { ...candidate, raw: enrichWithDetails(candidate.raw, details) };
        })
      )
    );

    const passedItems = enrichedPassed.map((candidate) => ({
      candidate,
      passed: true,
      rejection_reasons: [] as string[],
      niche: resolveCandidateNiche(normalizedNiche, candidate, runtime.mappings.nicheAliases),
    }));
    const rejectedItems = rejected.map(({ candidate, reasons }) => ({
      candidate,
      passed: false,
      rejection_reasons: reasons as string[],
      niche: resolveCandidateNiche(normalizedNiche, candidate, runtime.mappings.nicheAliases),
    }));

    const items = discoveryConfig.persist_rejected ? [...passedItems, ...rejectedItems] : passedItems;
    const { inserted, updated } = await upsertLeads(
      items,
      run.id,
      profileKey,
      (candidate) => tagCandidate(candidate, profileKey, discoveryConfig.social_domains)
    );

    const actualCostUsd = estimateActualCostUsd(textSearchRequestCount, detailsRequestCount);
    await completeRun(run.id, {
      places_requests: textSearchRequestCount + detailsRequestCount,
      estimated_cost_usd: actualCostUsd,
      leads_discovered: passed.length,
      leads_new: inserted.filter((lead) => lead.passed_filter).length,
      leads_updated: updated.filter((lead) => lead.passed_filter).length,
      leads_rejected: rejected.length,
      duration_ms: Date.now() - startedAt,
      ...(budgetAborted ? { budget_aborted: true } : {}),
    });
    try {
      const budgetResult = await incrementGooglePlacesBudgetSpent(actualCostUsd);
      if (budgetResult?.over_budget) {
        logger.warn({ budget_spent: budgetResult.budget_spent, budget_total: budgetResult.budget_total }, "GP budget exceeded after job completion");
        createAlert({
          kind: "gp_budget_threshold",
          severity: "warn",
          title: "Presupuesto Google Places excedido",
          description: `Gasto mensual USD ${budgetResult.budget_spent.toFixed(2)} supera el cap de USD ${budgetResult.budget_total.toFixed(2)}.`,
          payload: { budget_spent: budgetResult.budget_spent, budget_total: budgetResult.budget_total },
          dedup_key: "gp_budget_threshold:over_budget",
          dedup_window_minutes: 60,
        }).catch((err) => logger.warn({ err }, "Failed to create GP budget alert (non-critical)"));
      }
    } catch (err) {
      logger.error({ err, run_id: run.id, cost_usd: actualCostUsd }, "Failed to increment GP budget spent; run saved, use POST /pipeline/gp-budget/backfill to recover");
      throw err;
    }

    if (normalizedNiche && normalizedNiche !== "all") {
      try {
        const nicheLeads = await loadLeadsByNiche(normalizedNiche);
        const wordCounts = computeNicheStopWords(nicheLeads, 3, 0.05);
        await rebuildVocabularyForNiche(normalizedNiche, wordCounts);
      } catch (err) {
        logger.warn({ err }, "Vocabulary rebuild failed (best-effort)");
      }
    }

    return {
      runId: run.id,
      fetched: candidates.length,
      passed: passed.length,
      inserted: inserted.filter((lead) => lead.passed_filter).length,
      updated: updated.filter((lead) => lead.passed_filter).length,
      rejected: rejected.length,
      estimatedCostUsd: conservativeEstimate,
      actualCostUsd,
      budgetAborted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(run.id, message, Date.now() - startedAt);
    throw error;
  }
}
