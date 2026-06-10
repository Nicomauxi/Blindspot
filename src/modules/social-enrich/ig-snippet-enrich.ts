// Runner del enriquecimiento de IG vía snippet de DuckDuckGo (métricas + liveness, gratis).
// Itera los leads con IG seleccionada, consulta el snippet (throttled, secuencial — DDG es un
// host frágil que rate-limita: el paralelismo dispara su anti-bot), y fusiona vía buildSocialFusion.
// Degrada con gracia: si DDG bloquea N veces seguidas, corta el run (la IP quedó marcada).
import { getLogger } from "../../shared/logger.js";
import type { Lead } from "../../shared/types.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadSocialSearch,
  updateLeadSocialEnrichStatus,
} from "../../storage/leads.js";
import { buildSocialFusion, extractUsernameFromUrl } from "./social-fusion.js";
import { fetchInstagramSnippet } from "./duckduckgo-snippet.js";
import type { SocialProfileData } from "./social-fusion.js";

const DEFAULT_THROTTLE_MS = 2500;
const ANTI_BOT_ABORT_STREAK = 6; // nulls consecutivos → DDG bloqueó la IP, cortar

export interface IgSnippetStats {
  loaded: number;
  selected: number;
  enriched: number;
  no_snippet: number;
  skipped_no_url: number;
  aborted_anti_bot: boolean;
}

export interface IgSnippetOptions {
  all?: boolean;
  run?: string;
  limit?: number;
  throttleMs?: number;
  nowIso?: string;
  // Inyectables para test (sin red).
  lookup?: (username: string, opts: { throttleMs?: number }) => Promise<SocialProfileData | null>;
}

function instagramUrlOf(lead: Lead): string | null {
  const selected = lead.digital_footprint?.heuristic_discovery?.selected;
  const candidate = selected?.instagram as { url?: string } | null | undefined;
  return candidate?.url ?? null;
}

export async function runIgSnippetEnrich(opts: IgSnippetOptions): Promise<IgSnippetStats> {
  const log = getLogger();
  const lookup = opts.lookup ?? fetchInstagramSnippet;
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const candidates = loaded
    .filter((l) => l.passed_filter && instagramUrlOf(l) !== null)
    .slice(0, opts.limit ?? loaded.length);

  const stats: IgSnippetStats = {
    loaded: loaded.length,
    selected: candidates.length,
    enriched: 0,
    no_snippet: 0,
    skipped_no_url: 0,
    aborted_anti_bot: false,
  };

  let nullStreak = 0;
  for (const lead of candidates) {
    const igUrl = instagramUrlOf(lead);
    const username = extractUsernameFromUrl(igUrl);
    if (!username || !igUrl) {
      stats.skipped_no_url += 1;
      continue;
    }

    const profile = await lookup(username, { throttleMs });
    if (!profile) {
      stats.no_snippet += 1;
      nullStreak += 1;
      if (nullStreak >= ANTI_BOT_ABORT_STREAK) {
        stats.aborted_anti_bot = true;
        log.warn({ nullStreak }, "IG snippet enrich: DDG parece estar bloqueando — abortando run");
        break;
      }
      continue;
    }
    nullStreak = 0;

    const hasWebsite =
      Boolean(lead.website) || Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
    const fusion = await buildSocialFusion(lead, igUrl, profile, { ranAt: nowIso, nowIso, hasWebsite, allowLlm: false });
    await updateLeadSocialSearch(lead.id, fusion.socialSearch, fusion.tags, null, fusion.socialActivity, fusion.socialCanonical);
    await updateLeadSocialEnrichStatus(lead.id, "ok").catch(() => undefined);
    stats.enriched += 1;
  }

  log.info(stats, "IG snippet enrich complete");
  return stats;
}
