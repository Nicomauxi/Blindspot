// Fusión de un perfil social (bio + métricas) a la tubería común del lead, AGNÓSTICA de la
// fuente: sirve para cualquier proveedor que devuelva un SocialProfileData (snippet de
// buscador, dataset, etc.). La bio se parsea (regex-only, $0) → canonical_fields; las métricas
// → social_activity. Reemplaza el viejo adaptador específico de la Graph API de Meta (descartado
// por las Platform Terms); lo único que cambia entre fuentes es quién produce el SocialProfileData.
import { getLogger } from "../../shared/logger.js";
import type { Lead, PlaywrightInstagramSearchResult, PlaywrightSocialSearch } from "../../shared/types.js";
import { parseSocialDescription } from "./description-parse.js";
import { mergeSocialIntoCanonical } from "./social-canonical.js";
import {
  buildSocialActivitySnapshot,
  instagramProfileFromCounts,
  type SocialActivitySnapshot,
} from "./social-activity.js";

const CONFIRMATION_CONFIDENCE = 0.9;

// Datos públicos de un perfil de IG provenientes de cualquier fuente (snippet, dataset).
// recent_media puede venir vacío (p. ej. el snippet de buscador no trae timestamps).
export interface SocialProfileData {
  username: string | null;
  name: string | null;
  biography: string | null;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  website: string | null;
  recent_media: Array<{ caption: string | null; timestamp: string | null; like_count: number | null; comments_count: number | null }>;
}

export interface SocialFusionResult {
  socialSearch: PlaywrightSocialSearch;
  tags: string[];
  socialActivity: SocialActivitySnapshot;
  socialCanonical: Record<string, unknown> | null;
}

// Saca el handle de una URL de perfil de IG. Rechaza posts (/p/…), reels y rutas de sistema.
const NON_PROFILE_SEGMENTS = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "tv", "directory"]);

export function extractUsernameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleaned = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (!/^instagram\.com\//i.test(cleaned)) return null;
  const path = cleaned.slice("instagram.com/".length).split(/[?#]/)[0] ?? "";
  const first = path.split("/").filter(Boolean)[0];
  if (!first) return null;
  const handle = first.toLowerCase();
  if (NON_PROFILE_SEGMENTS.has(handle)) return null;
  if (!/^[a-z0-9._]+$/.test(handle)) return null;
  return handle;
}

function recencyDays(lastActivityAt: string | null, nowIso: string): number | null {
  if (!lastActivityAt) return null;
  const last = Date.parse(lastActivityAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - last) / 86_400_000));
}

// Construye el resultado de fusión desde un perfil social. `igUrl` es la URL ya seleccionada
// para el lead. Best-effort: si el parser falla, igual persiste métricas/actividad.
export async function buildSocialFusion(
  lead: Lead,
  igUrl: string,
  profile: SocialProfileData,
  ctx: { ranAt: string; nowIso: string; hasWebsite: boolean; allowLlm?: boolean }
): Promise<SocialFusionResult> {
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
    getLogger().warn({ leadId: lead.id, err: String(err) }, "social fusion: description parse failed");
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
    signals: profile.biography ? ["page_loaded", "bio_extracted"] : ["page_loaded"],
    // La fuente confirmó que la cuenta existe (indexada/registrada) → viva, sin login wall.
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
