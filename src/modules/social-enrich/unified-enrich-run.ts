// Fase 2: enriquecimiento unificado vía Serper. UNA query por lead trae website propio +
// IG/FB + reviews-meta (máxima data por crédito). Budget-gated + multi-key. Persiste el
// website faltante (desbloquea el re-enrich web), la señal social y, si el lead no tenía
// reviews de Google, las meta de un agregador (fill, no overwrite).
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import type { Lead, DuckDuckGoSocialSearch } from "../../shared/types.js";
import { loadAllPassedLeads, loadLeadsByRunId, updateLeadSocialSearch, updateLeadWebsite } from "../../storage/leads.js";
import { getSupabase } from "../../shared/supabase.js";
import { serperConfigured, unifiedLeadLookup } from "./serper-provider.js";
import { SerperBudget, type SerperBudgetState } from "./serper-budget.js";
import { buildSocialFusion } from "./social-fusion.js";
import { discoverSocialViaSearxng, makeSearxngDeps } from "./social-discover-searxng.js";
import { isRealWebsiteUrl } from "../../shared/website.js";

function hasRealWebsite(lead: Lead): boolean {
  return isRealWebsiteUrl(lead.website);
}

export interface UnifiedEnrichStats {
  candidates: number;
  found_website: number;
  found_instagram: number;
  found_metrics: number;
  found_review_meta: number;
  no_match: number;
  serper_queries_used: number;
  serper_stopped: "budget" | "all_keys_exhausted" | null;
  /** Leads resueltos por el motor lento (SearXNG) cuando Serper se quedó sin créditos. */
  fallback_searxng: number;
  fallback_found: number;
  elapsed_ms: number;
}

export interface UnifiedEnrichOptions {
  all?: boolean;
  run?: string;
  limit?: number;
  concurrency?: number;
  maxQueries?: number | null;
  serperFetch?: typeof fetch;
  nowIso?: string;
  // Fallback al motor lento (SearXNG, $0) para descubrir social cuando Serper se quedó sin
  // créditos. Default ON. SearXNG no trae website/reviews → en fallback solo se recupera social.
  searxngFallback?: boolean;
}

// Candidato: lead del pool al que le falta website real (el hueco grande). Si ya tiene web
// real, no gastamos query (el discovery social puro lo cubre el otro comando).
/**
 * FD-05: cuando Serper se queda sin `activeKey`, distinguir POR QUÉ. Si fue por tope de
 * costo (`--max-queries`), NO enrutar el resto del pool (~90%) al motor lento SearXNG
 * (lento, rate-limited por IP) — eso convierte un control de costo en bomba de latencia.
 * Solo el agotamiento real de keys justifica el fallback.
 */
export function resolveExhaustedAction(
  stoppedReason: SerperBudgetState["stoppedReason"],
  useFallback: boolean
): "fallback" | "no_match" {
  if (useFallback && stoppedReason === "all_keys_exhausted") return "fallback";
  return "no_match";
}

export function isUnifiedCandidate(lead: Lead): boolean {
  return lead.passed_filter === true && !hasRealWebsite(lead);
}

async function fillReviewMetaIfMissing(lead: Lead, meta: { rating: number; review_count: number }): Promise<void> {
  // Solo FILL: si el lead no tiene reviews de Google, usar las del agregador (mejor que nada
  // para la señal de demanda). Nunca pisa el dato de Google.
  if (lead.review_count != null) return;
  const { error } = await getSupabase()
    .from("leads")
    .update({ review_count: meta.review_count, rating: meta.rating })
    .eq("id", lead.id);
  if (error) getLogger().warn({ leadId: lead.id, err: error.message }, "review-meta fill no persistido");
}

export async function runUnifiedEnrich(opts: UnifiedEnrichOptions): Promise<UnifiedEnrichStats> {
  const log = getLogger();
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllPassedLeads();
  const candidates = loaded
    .filter(isUnifiedCandidate)
    .sort((a, b) => (b.prospect_score ?? -1) - (a.prospect_score ?? -1))
    .slice(0, opts.limit ?? loaded.length);

  const stats: UnifiedEnrichStats = {
    candidates: candidates.length,
    found_website: 0,
    found_instagram: 0,
    found_metrics: 0,
    found_review_meta: 0,
    no_match: 0,
    serper_queries_used: 0,
    serper_stopped: null,
    fallback_searxng: 0,
    fallback_found: 0,
    elapsed_ms: 0,
  };

  if (!serperConfigured()) {
    log.warn("runUnifiedEnrich: sin SERPER_API_KEY — nada que hacer");
    return stats;
  }

  const budget = SerperBudget.fromEnv(opts.maxQueries ?? null);
  const serperOpts = { budget, ...(opts.serperFetch ? { fetchImpl: opts.serperFetch } : {}), nowMs: Date.parse(nowIso) };
  const useFallback = opts.searxngFallback ?? true;
  const searxngDeps = makeSearxngDeps({});
  const limit = pLimit(Math.max(1, opts.concurrency ?? 4));
  const startedAt = Date.now();

  // Fallback motor lento (SearXNG): Serper sin créditos → descubrir social (sin website/reviews).
  async function processLeadFallback(lead: Lead): Promise<void> {
    stats.fallback_searxng += 1;
    const discovery = await discoverSocialViaSearxng(lead, searxngDeps, 0);
    const igUrl = discovery.instagram.best_url;
    if (!igUrl) { stats.no_match += 1; return; }
    stats.fallback_found += 1;
    stats.found_instagram += 1;
    const tags = new Set<string>(["ig-discovered"]);
    if (discovery.facebook.best_url) tags.add("fb-discovered");
    await updateLeadSocialSearch(lead.id, discovery, [...tags], null).catch((err) =>
      log.warn({ leadId: lead.id, err: String(err) }, "fallback social no persistido")
    );
  }

  async function processLead(lead: Lead): Promise<void> {
    if (budget.activeKey() === null) {
      // FD-05: fallback al motor lento SOLO si las keys se agotaron de verdad; si paramos
      // por tope --max-queries, diferir (no_match) y NO martillar SearXNG con el resto.
      if (resolveExhaustedAction(budget.stoppedReason(), useFallback) === "fallback") {
        await processLeadFallback(lead);
      } else {
        stats.no_match += 1;
      }
      return;
    }
    const r = await unifiedLeadLookup(lead, serperOpts);
    let touched = false;

    if (r.website) {
      await updateLeadWebsite(lead.id, r.website).catch((err) => log.warn({ leadId: lead.id, err: String(err) }, "website no persistido"));
      stats.found_website += 1;
      touched = true;
    }

    if (r.instagram.best_url) {
      stats.found_instagram += 1;
      touched = true;
      const social: DuckDuckGoSocialSearch = {
        ran_at: nowIso,
        source: "serper",
        instagram: r.instagram,
        facebook: r.facebook_url
          ? { query: "", results: [], best_url: r.facebook_url, additional_phones: [], confidence: 0.5 }
          : { query: "", results: [], best_url: null, additional_phones: [], confidence: 0 },
      };
      const tags = new Set<string>(["ig-discovered"]);
      if (r.facebook_url) tags.add("fb-discovered");
      if (r.metrics && r.igUsername) {
        const hasWebsite = Boolean(r.website) || hasRealWebsite(lead);
        const fusion = await buildSocialFusion(lead, r.instagram.best_url, r.metrics, { ranAt: nowIso, nowIso, hasWebsite, allowLlm: false });
        for (const t of fusion.tags) tags.add(t);
        stats.found_metrics += 1;
        await updateLeadSocialSearch(lead.id, social, [...tags], null, fusion.socialActivity, fusion.socialCanonical).catch((err) => log.warn({ leadId: lead.id, err: String(err) }, "social+metrics no persistido"));
      } else {
        await updateLeadSocialSearch(lead.id, social, [...tags], null).catch((err) => log.warn({ leadId: lead.id, err: String(err) }, "social no persistido"));
      }
    }

    if (r.review_meta) {
      await fillReviewMetaIfMissing(lead, r.review_meta);
      stats.found_review_meta += 1;
      touched = true;
    }

    if (!touched) stats.no_match += 1;
  }

  await Promise.all(candidates.map((lead) => limit(() => processLead(lead))));

  const bs = budget.state();
  stats.serper_queries_used = bs.queriesUsed;
  stats.serper_stopped = bs.stoppedReason;
  stats.elapsed_ms = Date.now() - startedAt;
  log.info(stats, "Unified enrich complete");
  return stats;
}
