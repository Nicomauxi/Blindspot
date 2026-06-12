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

export interface SocialDiscoverStats {
  loaded: number;
  candidates: number;
  found_instagram: number;
  found_facebook: number;
  found_any: number;
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
}

function hasSelectedInstagram(lead: Lead): boolean {
  return Boolean(lead.digital_footprint?.heuristic_discovery?.selected?.instagram?.url);
}

function hasRealWebsite(lead: Lead): boolean {
  const w = lead.website;
  return !!w && w.trim().length > 0 && !/(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com)/i.test(w);
}

function alreadyDiscovered(lead: Lead): boolean {
  return lead.digital_footprint?.social_search?.source === "searxng";
}

// Candidato F1: lead del pool digital-dark (sin web real ni IG seleccionada) que no fue
// ya descubierto vía SearXNG.
export function isDiscoverCandidate(lead: Lead): boolean {
  if (!lead.passed_filter) return false;
  if (hasRealWebsite(lead)) return false;
  if (hasSelectedInstagram(lead)) return false;
  if (alreadyDiscovered(lead)) return false;
  return true;
}

export async function runSocialDiscovery(opts: SocialDiscoverOptions): Promise<SocialDiscoverStats> {
  const log = getLogger();
  const deps = opts.deps ?? makeSearxngDeps(opts.throttleMs != null ? { throttleMs: opts.throttleMs } : {});
  const throttleMs = opts.throttleMs ?? 0;

  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const candidates = loaded
    .filter(isDiscoverCandidate)
    .sort((a, b) => (b.prospect_score ?? -1) - (a.prospect_score ?? -1))
    .slice(0, opts.limit ?? loaded.length);

  const stats: SocialDiscoverStats = {
    loaded: loaded.length,
    candidates: candidates.length,
    found_instagram: 0,
    found_facebook: 0,
    found_any: 0,
    no_match: 0,
    elapsed_ms: 0,
    leads_per_sec: 0,
  };

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const limit = pLimit(concurrency);
  const startedAt = Date.now();

  async function processLead(lead: Lead): Promise<void> {
    const discovery = await discoverSocialViaSearxng(lead, deps, throttleMs);
    const igUrl = discovery.instagram.best_url;
    const fbUrl = discovery.facebook.best_url;
    if (!igUrl && !fbUrl) {
      stats.no_match += 1;
      return;
    }
    const tags: string[] = [];
    if (igUrl) {
      stats.found_instagram += 1;
      tags.push("ig-discovered");
    }
    if (fbUrl) {
      stats.found_facebook += 1;
      tags.push("fb-discovered");
    }
    stats.found_any += 1;
    await updateLeadSocialSearch(lead.id, discovery, tags, null).catch((err) =>
      log.warn({ leadId: lead.id, err: String(err) }, "social_search descubierto no persistido")
    );
  }

  await Promise.all(candidates.map((lead) => limit(() => processLead(lead))));

  stats.elapsed_ms = Date.now() - startedAt;
  stats.leads_per_sec =
    stats.elapsed_ms > 0 ? Number((candidates.length / (stats.elapsed_ms / 1000)).toFixed(2)) : 0;

  log.info(stats, "Social discovery (SearXNG) complete");
  return stats;
}
