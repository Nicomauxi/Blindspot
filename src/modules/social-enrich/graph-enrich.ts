// Enriquecimiento de Instagram vía Graph API business_discovery, conectado a la MISMA
// tubería de fusión que el scraping (parseSocialDescription + canonical_fields + actividad).
// La API es la fuente; el resto del pipeline no cambia. Inactivo si no hay token.
import { getLogger } from "../../shared/logger.js";
import type { Lead, PlaywrightInstagramSearchResult, PlaywrightSocialSearch } from "../../shared/types.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadSocialSearch,
  updateLeadSocialEnrichStatus,
} from "../../storage/leads.js";
import { parseSocialDescription } from "./description-parse.js";
import { mergeSocialIntoCanonical } from "./social-canonical.js";
import {
  buildSocialActivitySnapshot,
  instagramProfileFromCounts,
  type SocialActivitySnapshot,
} from "./social-activity.js";
import {
  extractUsernameFromUrl,
  isGraphApiEnabled,
  lookupInstagramBusiness,
  type GraphBusinessProfile,
} from "./graph-api.js";

const CONFIRMATION_CONFIDENCE = 0.9;

export interface GraphFusionResult {
  socialSearch: PlaywrightSocialSearch;
  tags: string[];
  socialActivity: SocialActivitySnapshot;
  socialCanonical: Record<string, unknown> | null;
}

function recencyDays(lastActivityAt: string | null, nowIso: string): number | null {
  if (!lastActivityAt) return null;
  const last = Date.parse(lastActivityAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - last) / 86_400_000));
}

// Construye el resultado de fusión a partir del perfil que devolvió la Graph API.
// `igUrl` es la URL de IG ya seleccionada para el lead. Best-effort en el parsing: si el
// parser falla, igual persiste métricas/actividad. `allowLlm` default false (regex-only, $0).
export async function buildInstagramGraphFusion(
  lead: Lead,
  igUrl: string,
  profile: GraphBusinessProfile,
  ctx: { ranAt: string; nowIso: string; hasWebsite: boolean; allowLlm?: boolean }
): Promise<GraphFusionResult> {
  const lastActivityAt = profile.recent_media.find((m) => m.timestamp)?.timestamp ?? null;
  const activityProfile = instagramProfileFromCounts(igUrl, {
    followers: profile.followers_count,
    following: profile.follows_count,
    posts: profile.media_count,
    lastActivityAt,
    nowIso: ctx.nowIso,
  });

  let socialCanonical: Record<string, unknown> | null = null;
  let parsedPhone: string | null = null;
  let parsedEmail: string | null = null;
  try {
    const parsed = await parseSocialDescription(profile.biography, "instagram", {
      allowLlm: ctx.allowLlm ?? false,
    });
    parsedPhone = parsed.phones[0] ?? null;
    parsedEmail = parsed.emails[0] ?? null;
    socialCanonical = mergeSocialIntoCanonical(lead, [
      { profile: activityProfile, parsed, recencyDays: recencyDays(lastActivityAt, ctx.nowIso) },
    ]);
  } catch (err) {
    getLogger().warn({ leadId: lead.id, err: String(err) }, "graph fusion: description parse failed");
  }

  const instagram: PlaywrightInstagramSearchResult = {
    url: igUrl,
    name: profile.name,
    bio: profile.biography,
    email: parsedEmail,
    phone: parsedPhone,
    external_url: profile.website,
    has_contact_button: false,
    confidence: CONFIRMATION_CONFIDENCE,
    // Señales válidas del enum compartido. La procedencia (Graph API) queda implícita
    // en que liveness=alive sin scraping y confidence alto.
    signals: profile.biography ? ["page_loaded", "bio_extracted"] : ["page_loaded"],
    // La API confirma que la cuenta existe y es profesional → viva (sin login wall).
    liveness: {
      state: "alive",
      reason: null,
      http_status: 200,
      final_url: igUrl,
      checked_at: ctx.ranAt,
      detector_version: 1,
    },
  };

  const socialSearch: PlaywrightSocialSearch = {
    ran_at: ctx.ranAt,
    source: "playwright",
    facebook: null,
    instagram,
  };

  return {
    socialSearch,
    tags: ["ig-confirmed"],
    socialActivity: buildSocialActivitySnapshot([activityProfile], { ranAt: ctx.ranAt, hasWebsite: ctx.hasWebsite }),
    socialCanonical,
  };
}

// ─── Runner: enriquecimiento de la colección vía Graph API ───────────────────────
// La PRIMERA corrida es también la medición: cuántos leads son cuenta profesional
// (enriched) vs personal/privada (not_professional) vs inexistente (not_found).

export interface GraphEnrichStats {
  loaded: number;
  selected: number;
  enriched: number;
  not_professional: number;
  not_found: number;
  rate_limited: number;
  errors: number;
  skipped_no_url: number;
}

export interface GraphEnrichOptions {
  all?: boolean;
  run?: string;
  limit?: number;
  allowLlm?: boolean;
  nowIso?: string;
  sleepFn?: (ms: number) => Promise<void>;
  rateLimitBackoffMs?: number;
}

function instagramUrlOf(lead: Lead): string | null {
  const selected = lead.digital_footprint?.heuristic_discovery?.selected;
  const candidate = selected?.instagram as { url?: string } | null | undefined;
  return candidate?.url ?? null;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runInstagramGraphEnrich(opts: GraphEnrichOptions): Promise<GraphEnrichStats> {
  if (!isGraphApiEnabled()) {
    throw new Error(
      "Instagram Graph API inactiva: configurá META_IG_USER_ID y META_GRAPH_TOKEN para usar business_discovery."
    );
  }
  const log = getLogger();
  const sleep = opts.sleepFn ?? defaultSleep;
  const backoffMs = opts.rateLimitBackoffMs ?? 60_000;
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const candidates = loaded
    .filter((l) => l.passed_filter && instagramUrlOf(l) !== null)
    .slice(0, opts.limit ?? loaded.length);

  const stats: GraphEnrichStats = {
    loaded: loaded.length,
    selected: candidates.length,
    enriched: 0,
    not_professional: 0,
    not_found: 0,
    rate_limited: 0,
    errors: 0,
    skipped_no_url: 0,
  };

  for (const lead of candidates) {
    const igUrl = instagramUrlOf(lead);
    const username = extractUsernameFromUrl(igUrl);
    if (!username || !igUrl) {
      stats.skipped_no_url += 1;
      continue;
    }

    let result = await lookupInstagramBusiness(username);
    // Backoff + reintento único ante límite de la app.
    if (result.status === "rate_limited") {
      stats.rate_limited += 1;
      await sleep(backoffMs);
      result = await lookupInstagramBusiness(username);
    }

    switch (result.status) {
      case "ok": {
        const hasWebsite =
          Boolean(lead.website) || Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
        const fusion = await buildInstagramGraphFusion(lead, igUrl, result.profile, {
          ranAt: nowIso,
          nowIso,
          hasWebsite,
          ...(opts.allowLlm !== undefined ? { allowLlm: opts.allowLlm } : {}),
        });
        await updateLeadSocialSearch(lead.id, fusion.socialSearch, fusion.tags, null, fusion.socialActivity, fusion.socialCanonical);
        await updateLeadSocialEnrichStatus(lead.id, "ok").catch(() => undefined);
        stats.enriched += 1;
        break;
      }
      case "not_professional":
        stats.not_professional += 1;
        break;
      case "not_found":
        stats.not_found += 1;
        break;
      case "rate_limited":
        // Persistió tras el reintento: lo dejamos para la próxima corrida.
        stats.errors += 1;
        break;
      case "auth_error":
        // Token roto: abortar el run entero (no tiene sentido seguir consultando).
        throw new Error(`Instagram Graph API auth error (token): ${result.message}`);
      case "disabled":
        throw new Error("Instagram Graph API inactiva a mitad de corrida.");
      default:
        stats.errors += 1;
        break;
    }
  }

  log.info(stats, "Instagram Graph enrich complete");
  return stats;
}
