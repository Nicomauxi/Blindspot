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
// N50: sin verificación de identidad (el nombre/bio del perfil no menciona al negocio)
// la cuenta NO se confirma: confidence degradada y liveness sin afirmar.
const UNVERIFIED_CONFIDENCE = 0.6;

function tokensOf(value: string | null): string[] {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

// Mismo criterio que la vía playwright (instagram.ts nameMatches): ≥50% de los tokens
// del nombre del lead presentes en name/bio/username del perfil.
export function profileMatchesLead(profile: SocialProfileData, leadName: string): boolean {
  const haystack = new Set([
    ...tokensOf(profile.name),
    ...tokensOf(profile.biography),
    ...tokensOf(profile.username),
  ]);
  const expected = tokensOf(leadName);
  if (expected.length === 0 || haystack.size === 0) return false;
  const overlap = expected.filter((t) => haystack.has(t)).length;
  return overlap / expected.length >= 0.5;
}

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
  // FS-03: only adopt audience/liveness metrics when the profile's identity matches
  // the business. Otherwise followers/tier could belong to a homonymous account and
  // would inflate the ranking (audience_bonus) and mislead the vendor.
  const identityVerified = profileMatchesLead(profile, lead.name);
  const lastActivityAt = profile.recent_media.find((m) => m.timestamp)?.timestamp ?? null;
  const activityProfile = instagramProfileFromCounts(igUrl, {
    followers: identityVerified ? profile.followers_count : null,
    following: identityVerified ? profile.follows_count : null,
    posts: profile.media_count,
    // Without verified identity, do not claim the account is "alive": no dated
    // activity → activity_status stays "unknown" (no red_activa, no active_bonus).
    ...(identityVerified && lastActivityAt != null ? { lastActivityAt } : {}),
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
    confidence: identityVerified ? CONFIRMATION_CONFIDENCE : UNVERIFIED_CONFIDENCE,
    signals: profile.biography ? ["page_loaded", "bio_extracted"] : ["page_loaded"],
    // N50: un índice de buscador NO prueba que la cuenta esté viva HOY (puede ser caché
    // de una cuenta borrada) — solo se afirma alive con identidad verificada.
    liveness: {
      state: identityVerified ? "alive" : "unverified",
      reason: null,
      http_status: identityVerified ? 200 : null,
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
    tags: [identityVerified ? "ig-confirmed" : "ig-snippet-unverified"],
    socialActivity: buildSocialActivitySnapshot([activityProfile], { ranAt: ctx.ranAt, hasWebsite: ctx.hasWebsite }),
    socialCanonical,
  };
}
