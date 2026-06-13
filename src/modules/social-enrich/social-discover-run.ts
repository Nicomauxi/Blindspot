// F1 runner: descubrimiento social vía SearXNG sobre leads digital-dark (sin web ni
// social), concurrente e instrumentado (leads/seg). Mismo patrón que ig-snippet-enrich.
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import type { Lead } from "../../shared/types.js";
import { loadAllLeads, loadLeadsByRunId, updateLeadSocialSearch } from "../../storage/leads.js";
import {
  discoverSocialViaSearxng,
  makeSearxngDeps,
  type SocialDiscoverDeps,
} from "./social-discover-searxng.js";
import { buildSocialFusion, extractUsernameFromUrl } from "./social-fusion.js";
import { defaultIgLookupChain, type IgLookup } from "./ig-lookup-chain.js";
import { serperConfigured, discoverEnrichViaSerper } from "./serper-provider.js";

export interface SocialDiscoverStats {
  loaded: number;
  candidates: number;
  found_instagram: number;
  found_facebook: number;
  found_any: number;
  /** withMetrics: perfiles con followers/liveness extraídos (señal de scoring). */
  found_metrics: number;
  /** withMetrics: perfil hallado pero sin métricas públicas (cuenta privada/sin og). */
  found_url_no_metrics: number;
  no_match: number;
  elapsed_ms: number;
  leads_per_sec: number;
}

export interface SocialDiscoverOptions {
  all?: boolean;
  run?: string;
  limit?: number;
  concurrency?: number;
  throttleMs?: number;
  deps?: SocialDiscoverDeps; // inyectable para test
  nowIso?: string;
  // F1 integrado: tras descubrir el perfil, extraer métricas (followers/liveness) en la
  // misma pasada → social_activity que consume el scoring. Sin esto solo se guarda la URL.
  withMetrics?: boolean;
  lookup?: IgLookup; // inyectable para test
  // provider de búsqueda: "serper" (Google SERP API, 1 query trae URL+métricas, sin
  // rate-limit) o "searxng" ($0 local). Default: serper si hay SERPER_API_KEY, si no searxng.
  provider?: "serper" | "searxng";
  serperFetch?: typeof fetch; // inyectable para test del path Serper
}

// ¿El lead ya tiene MÉTRICAS sociales reales (no solo una URL)?
function hasSocialMetrics(lead: Lead): boolean {
  const sa = lead.digital_footprint?.social_activity;
  if (!sa) return false;
  if (sa.summary?.audience_tier != null) return true;
  if (Array.isArray(sa.summary?.active_platforms) && sa.summary.active_platforms.length > 0) return true;
  const profiles = sa.profiles ?? {};
  return Object.values(profiles).some(
    (p) => (typeof p?.followers === "number" && p.followers > 0) || (typeof p?.likes === "number" && p.likes > 0)
  );
}

function hasSelectedInstagram(lead: Lead): boolean {
  return Boolean(lead.digital_footprint?.heuristic_discovery?.selected?.instagram?.url);
}

function hasRealWebsite(lead: Lead): boolean {
  const w = lead.website;
  return !!w && w.trim().length > 0 && !/(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com)/i.test(w);
}

function alreadyDiscovered(lead: Lead): boolean {
  const source = lead.digital_footprint?.social_search?.source;
  return source === "searxng" || source === "serper";
}

// Candidato F1: lead del pool digital-dark (sin web real ni IG seleccionada).
// En modo withMetrics, un lead ya-descubierto-pero-SIN-métricas SÍ es candidato (hay que
// enriquecerlo); sin withMetrics, se excluye lo ya descubierto.
export function isDiscoverCandidate(lead: Lead, withMetrics = false): boolean {
  if (!lead.passed_filter) return false;
  if (hasRealWebsite(lead)) return false;
  if (hasSelectedInstagram(lead)) return false;
  if (alreadyDiscovered(lead)) {
    return withMetrics && !hasSocialMetrics(lead); // re-enriquecer URL sin métricas
  }
  return true;
}

export async function runSocialDiscovery(opts: SocialDiscoverOptions): Promise<SocialDiscoverStats> {
  const log = getLogger();
  const deps = opts.deps ?? makeSearxngDeps(opts.throttleMs != null ? { throttleMs: opts.throttleMs } : {});
  const throttleMs = opts.throttleMs ?? 0;
  const withMetrics = opts.withMetrics ?? false;
  const lookup = opts.lookup ?? defaultIgLookupChain();
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const candidates = loaded
    .filter((l) => isDiscoverCandidate(l, withMetrics))
    .sort((a, b) => (b.prospect_score ?? -1) - (a.prospect_score ?? -1))
    .slice(0, opts.limit ?? loaded.length);

  const stats: SocialDiscoverStats = {
    loaded: loaded.length,
    candidates: candidates.length,
    found_instagram: 0,
    found_facebook: 0,
    found_any: 0,
    found_metrics: 0,
    found_url_no_metrics: 0,
    no_match: 0,
    elapsed_ms: 0,
    leads_per_sec: 0,
  };

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const limit = pLimit(concurrency);
  const startedAt = Date.now();

  const provider = opts.provider ?? (serperConfigured() ? "serper" : "searxng");
  const serperOpts = opts.serperFetch ? { fetchImpl: opts.serperFetch } : {};

  // Path Serper: 1 query trae URL del perfil + snippet con followers → descubre Y enriquece
  // en un solo crédito, sin rate-limit. IG only (FB se omite para no gastar el doble).
  async function processLeadSerper(lead: Lead): Promise<void> {
    const { instagram, metrics, igUsername } = await discoverEnrichViaSerper(lead, serperOpts);
    const igUrl = instagram.best_url;
    if (!igUrl) {
      stats.no_match += 1;
      return;
    }
    stats.found_instagram += 1;
    stats.found_any += 1;
    const social: import("../../shared/types.js").DuckDuckGoSocialSearch = {
      ran_at: nowIso,
      source: "serper",
      instagram,
      facebook: { query: "", results: [], best_url: null, additional_phones: [], confidence: 0 },
    };
    const tags = new Set<string>(["ig-discovered"]);

    if (metrics && igUsername) {
      const hasWebsite =
        Boolean(lead.website) || Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
      const fusion = await buildSocialFusion(lead, igUrl, metrics, { ranAt: nowIso, nowIso, hasWebsite, allowLlm: false });
      for (const t of fusion.tags) tags.add(t);
      stats.found_metrics += 1;
      await updateLeadSocialSearch(lead.id, social, [...tags], null, fusion.socialActivity, fusion.socialCanonical).catch((err) =>
        log.warn({ leadId: lead.id, err: String(err) }, "serper enrich no persistido")
      );
      return;
    }
    stats.found_url_no_metrics += 1;
    await updateLeadSocialSearch(lead.id, social, [...tags], null).catch((err) =>
      log.warn({ leadId: lead.id, err: String(err) }, "serper discover no persistido")
    );
  }

  async function processLeadSearxng(lead: Lead): Promise<void> {
    const discovery = await discoverSocialViaSearxng(lead, deps, throttleMs);
    const igUrl = discovery.instagram.best_url;
    const fbUrl = discovery.facebook.best_url;
    if (!igUrl && !fbUrl) {
      stats.no_match += 1;
      return;
    }
    const tags = new Set<string>();
    if (igUrl) {
      stats.found_instagram += 1;
      tags.add("ig-discovered");
    }
    if (fbUrl) {
      stats.found_facebook += 1;
      tags.add("fb-discovered");
    }
    stats.found_any += 1;

    // Pasada integrada: si hay IG y se pidió métricas, extraerlas en el mismo flujo.
    if (withMetrics && igUrl) {
      const username = extractUsernameFromUrl(igUrl);
      const profile = username ? await lookup(username, { throttleMs }) : null;
      if (profile) {
        const hasWebsite =
          Boolean(lead.website) || Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
        const fusion = await buildSocialFusion(lead, igUrl, profile, { ranAt: nowIso, nowIso, hasWebsite, allowLlm: false });
        for (const t of fusion.tags) tags.add(t);
        stats.found_metrics += 1;
        // Persistir las URLs descubiertas (social_search) + las métricas (social_activity/canonical).
        await updateLeadSocialSearch(lead.id, discovery, [...tags], null, fusion.socialActivity, fusion.socialCanonical).catch((err) =>
          log.warn({ leadId: lead.id, err: String(err) }, "social enrich integrado no persistido")
        );
        return;
      }
      stats.found_url_no_metrics += 1; // perfil hallado, sin métricas públicas
    }

    await updateLeadSocialSearch(lead.id, discovery, [...tags], null).catch((err) =>
      log.warn({ leadId: lead.id, err: String(err) }, "social_search descubierto no persistido")
    );
  }

  const processLead = provider === "serper" ? processLeadSerper : processLeadSearxng;
  await Promise.all(candidates.map((lead) => limit(() => processLead(lead))));

  stats.elapsed_ms = Date.now() - startedAt;
  stats.leads_per_sec =
    stats.elapsed_ms > 0 ? Number((candidates.length / (stats.elapsed_ms / 1000)).toFixed(2)) : 0;

  log.info({ ...stats, provider }, "Social discovery complete");
  return stats;
}
