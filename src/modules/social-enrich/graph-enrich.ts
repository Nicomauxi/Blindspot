// Enriquecimiento de Instagram vía Graph API business_discovery, conectado a la MISMA
// tubería de fusión que el scraping (parseSocialDescription + canonical_fields + actividad).
// La API es la fuente; el resto del pipeline no cambia. Inactivo si no hay token.
import { getLogger } from "../../shared/logger.js";
import type { Lead, PlaywrightInstagramSearchResult, PlaywrightSocialSearch } from "../../shared/types.js";
import { parseSocialDescription } from "./description-parse.js";
import { mergeSocialIntoCanonical } from "./social-canonical.js";
import {
  buildSocialActivitySnapshot,
  instagramProfileFromCounts,
  type SocialActivitySnapshot,
} from "./social-activity.js";
import type { GraphBusinessProfile } from "./graph-api.js";

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
