// Parsing y clasificación de actividad/audiencia social a partir de datos públicos
// (meta tags og:description de Instagram/Facebook). No requiere login ni API con permisos.
//
// Lo obtenible públicamente y $0:
//   - Instagram og:description: "1,234 Followers, 567 Following, 89 Posts - ..."
//   - Facebook og:description:   "Nombre. 1,234 likes · 56 talking about this · ..."
// La actividad reciente (último post / frecuencia) suele estar tras login-wall → unknown.

export type AudienceTier = "low" | "medium" | "high";
export type ActivityStatus = "active" | "abandoned" | "unknown";

export interface SocialProfileMetrics {
  followers: number | null;
  following: number | null;
  posts: number | null;
  // Facebook expone "likes" como proxy de audiencia y "talking_about" como engagement reciente.
  likes: number | null;
  talking_about: number | null;
}

export interface SocialActivityProfile extends SocialProfileMetrics {
  platform: "instagram" | "facebook";
  url: string;
  audience_tier: AudienceTier | null;
  activity_status: ActivityStatus;
}

// Parsea conteos sociales: "1,234" | "10K" | "1.2M" | "10 mil" | "1,2 mill" → número.
export function parseSocialCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.toString().trim().toLowerCase().replace(/ /g, " ");
  // Orden longest-first: "mil"/"mill…" deben evaluarse antes que "m" suelta.
  const match = text.match(/([\d.,]+)\s*(k|millones|mill(?:[oó]n)?|mil|m)?/);
  if (!match) return null;

  const numPart = match[1]!;
  const suffix = match[2] ?? "";

  // Determinar separador decimal vs miles.
  let normalized = numPart;
  const hasComma = numPart.includes(",");
  const hasDot = numPart.includes(".");
  if (hasComma && hasDot) {
    // El último separador es el decimal; el otro es de miles.
    const lastComma = numPart.lastIndexOf(",");
    const lastDot = numPart.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = numPart.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = numPart.replace(/,/g, "");
    }
  } else if (hasComma) {
    // "1,234" (miles) vs "1,2" (decimal): si tras la coma hay exactamente 3 dígitos → miles.
    normalized = /,\d{3}\b/.test(numPart) && !suffix ? numPart.replace(/,/g, "") : numPart.replace(",", ".");
  } else if (hasDot) {
    normalized = /\.\d{3}\b/.test(numPart) && !suffix ? numPart.replace(/\./g, "") : numPart;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  let multiplier = 1;
  if (suffix === "k") multiplier = 1_000;
  else if (suffix.startsWith("mill") || suffix === "millones" || suffix === "m") multiplier = 1_000_000;
  else if (suffix === "mil") multiplier = 1_000;

  return Math.round(value * multiplier);
}

// Extrae followers/following/posts del og:description de Instagram.
export function parseInstagramMetrics(ogDescription: string | null | undefined): SocialProfileMetrics {
  const text = (ogDescription ?? "").replace(/ /g, " ");
  const grab = (label: RegExp): number | null => {
    const m = text.match(label);
    return m ? parseSocialCount(m[1]) : null;
  };
  return {
    followers: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+followers/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+seguidores/i),
    following: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+following/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+sigui/i),
    posts: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+posts/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+publicaciones/i),
    likes: null,
    talking_about: null,
  };
}

// Extrae likes/talking_about del og:description de Facebook.
export function parseFacebookMetrics(ogDescription: string | null | undefined): SocialProfileMetrics {
  const text = (ogDescription ?? "").replace(/ /g, " ");
  const grab = (label: RegExp): number | null => {
    const m = text.match(label);
    return m ? parseSocialCount(m[1]) : null;
  };
  return {
    followers: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+followers/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+seguidores/i),
    following: null,
    posts: null,
    likes: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+likes/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+me gusta/i),
    talking_about: grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+talking about/i) ?? grab(/([\d.,]+\s*(?:k|m|mil|mill[a-zóé]*)?)\s+personas est[aá]n hablando/i),
  };
}

const AUDIENCE_MEDIUM = 1_000;
const AUDIENCE_HIGH = 10_000;

export function classifyAudience(audience: number | null): AudienceTier | null {
  if (audience == null) return null;
  if (audience >= AUDIENCE_HIGH) return "high";
  if (audience >= AUDIENCE_MEDIUM) return "medium";
  return "low";
}

// Estado de actividad. Con datos públicos solo podemos inferir señales débiles:
// "talking about this" reciente (FB) sugiere actividad; sin esa señal y sin acceso al
// timeline, queda "unknown". Cuando haya last_activity_at explícito se usa el umbral.
const ABANDONED_DAYS = 90;

export function classifyActivity(opts: {
  talkingAbout?: number | null;
  lastActivityAt?: string | null;
  nowIso?: string | null;
}): ActivityStatus {
  if (opts.lastActivityAt) {
    const last = Date.parse(opts.lastActivityAt);
    const now = opts.nowIso ? Date.parse(opts.nowIso) : Number.NaN;
    if (Number.isFinite(last) && Number.isFinite(now)) {
      const days = (now - last) / 86_400_000;
      return days <= ABANDONED_DAYS ? "active" : "abandoned";
    }
  }
  if (opts.talkingAbout != null && opts.talkingAbout > 0) return "active";
  return "unknown";
}

// Construye el perfil de actividad de Instagram a partir del og:description (bio).
export function instagramProfile(url: string, ogDescription: string | null): SocialActivityProfile {
  const m = parseInstagramMetrics(ogDescription);
  return {
    platform: "instagram",
    url,
    ...m,
    audience_tier: classifyAudience(m.followers),
    activity_status: classifyActivity({ talkingAbout: m.talking_about }),
  };
}

// Construye el perfil de actividad desde counts ESTRUCTURADOS (Instagram Graph API
// business_discovery), no desde el og:description. Ventaja sobre el scraping: con el
// timestamp del último media sabemos la actividad real (active/abandoned), no "unknown".
export function instagramProfileFromCounts(
  url: string,
  opts: {
    followers: number | null;
    following: number | null;
    posts: number | null;
    lastActivityAt?: string | null;
    nowIso?: string | null;
  }
): SocialActivityProfile {
  return {
    platform: "instagram",
    url,
    followers: opts.followers,
    following: opts.following,
    posts: opts.posts,
    likes: null,
    talking_about: null,
    audience_tier: classifyAudience(opts.followers),
    activity_status: classifyActivity({
      ...(opts.lastActivityAt != null ? { lastActivityAt: opts.lastActivityAt } : {}),
      ...(opts.nowIso != null ? { nowIso: opts.nowIso } : {}),
    }),
  };
}

// Construye el perfil de actividad de Facebook a partir del og:description.
export function facebookProfile(url: string, ogDescription: string | null): SocialActivityProfile {
  const m = parseFacebookMetrics(ogDescription);
  return {
    platform: "facebook",
    url,
    ...m,
    audience_tier: classifyAudience(m.likes ?? m.followers),
    activity_status: classifyActivity({ talkingAbout: m.talking_about }),
  };
}

export interface SocialActivitySnapshot {
  ran_at: string;
  source: "playwright_public";
  profiles: Record<string, SocialActivityProfile>;
  summary: {
    has_social_presence: boolean;
    active_platforms: string[];
    abandoned_platforms: string[];
    best_platform: string | null;
    audience_tier: AudienceTier | null;
    commercial_signals: string[];
  };
}

// Audiencia comparable por plataforma: followers (IG) o likes (FB).
function audienceOf(p: SocialActivityProfile): number | null {
  return p.followers ?? p.likes ?? null;
}

// Ensambla el snapshot persistible en digital_footprint.social_activity y deriva las
// señales comerciales para scoring/CRM.
export function buildSocialActivitySnapshot(
  profiles: SocialActivityProfile[],
  ctx: { ranAt: string; hasWebsite: boolean }
): SocialActivitySnapshot {
  const byPlatform: Record<string, SocialActivityProfile> = {};
  for (const p of profiles) byPlatform[p.platform] = p;

  const active = profiles.filter((p) => p.activity_status === "active").map((p) => p.platform);
  const abandoned = profiles.filter((p) => p.activity_status === "abandoned").map((p) => p.platform);

  let best: SocialActivityProfile | null = null;
  for (const p of profiles) {
    if (best == null || (audienceOf(p) ?? -1) > (audienceOf(best) ?? -1)) best = p;
  }
  const bestAudience = best ? audienceOf(best) : null;
  const audienceTier = classifyAudience(bestAudience);

  const signals: string[] = [];
  const hasPresence = profiles.length > 0;
  if (active.length > 0) signals.push("red_activa");
  if (abandoned.length > 0 && active.length === 0) signals.push("red_abandonada");
  if (audienceTier === "high") signals.push("alta_audiencia");
  else if (audienceTier === "medium") signals.push("audiencia_media");
  if (hasPresence && audienceTier === "high" && !ctx.hasWebsite) signals.push("alta_audiencia_sin_web");

  return {
    ran_at: ctx.ranAt,
    source: "playwright_public",
    profiles: byPlatform,
    summary: {
      has_social_presence: hasPresence,
      active_platforms: active,
      abandoned_platforms: abandoned,
      best_platform: best?.platform ?? null,
      audience_tier: audienceTier,
      commercial_signals: signals,
    },
  };
}
