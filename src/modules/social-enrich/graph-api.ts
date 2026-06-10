// Cliente de la Instagram Graph API — endpoint `business_discovery` (vía oficial, gratis,
// sin riesgo de ToS). Dado el username de IG de un negocio, devuelve sus datos PÚBLICOS
// (bio + followers/follows/media + últimos media) usando NUESTRA cuenta profesional como
// "lente". Sólo funciona si la cuenta objetivo es professional (business/creator).
//
// Config por env (token en stand-by hasta que se setee): la fuente queda INACTIVA si falta.
//   META_IG_USER_ID   — IG User ID de nuestra cuenta profesional (la que hace la consulta)
//   META_GRAPH_TOKEN  — access token (long-lived o system user)
//   META_GRAPH_VERSION (opcional, default v21.0)
//   META_GRAPH_BASE_URL (opcional, default https://graph.facebook.com)
//
// Los env se leen POR LLAMADA (no const al arranque): permite activar la fuente sin reiniciar.

const DEFAULT_VERSION = "v21.0";
const DEFAULT_BASE_URL = "https://graph.facebook.com";

export interface GraphRecentMedia {
  caption: string | null;
  timestamp: string | null;
  like_count: number | null;
  comments_count: number | null;
}

export interface GraphBusinessProfile {
  username: string | null;
  name: string | null;
  biography: string | null;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  website: string | null;
  recent_media: GraphRecentMedia[];
}

// Resultado discriminado: el caller decide qué hacer con cada estado (enriquecer / saltear /
// backoff / abortar). Mantener separados los casos "recuperables" (skip) de los "fatales".
export type GraphLookupResult =
  | { status: "ok"; profile: GraphBusinessProfile }
  | { status: "not_professional" } // la cuenta objetivo es personal/privada → no aplica
  | { status: "not_found" } // el username no existe
  | { status: "disabled" } // sin token configurado → fuente inactiva
  | { status: "rate_limited" } // límite de la app → backoff
  | { status: "auth_error"; message: string } // token inválido/expirado → abortar run
  | { status: "error"; message: string }; // inesperado/red → skip best-effort

export function isGraphApiEnabled(): boolean {
  return Boolean(
    (process.env["META_IG_USER_ID"] ?? "").trim() && (process.env["META_GRAPH_TOKEN"] ?? "").trim()
  );
}

// Saca el handle de una URL de perfil de IG. Rechaza posts (/p/…), reels, y rutas de sistema
// (accounts/explore/etc.) que no son perfiles.
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
  // Usernames válidos de IG: letras, números, punto y guión bajo.
  if (!/^[a-z0-9._]+$/.test(handle)) return null;
  return handle;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);
const AUTH_CODES = new Set([190, 102, 10, 200]);

function classifyError(err: { code?: number; message?: string }): GraphLookupResult {
  const code = typeof err.code === "number" ? err.code : -1;
  const msg = (err.message ?? "").toLowerCase();
  if (AUTH_CODES.has(code) || msg.includes("access token")) {
    return { status: "auth_error", message: err.message ?? "auth error" };
  }
  if (RATE_LIMIT_CODES.has(code) || msg.includes("request limit") || msg.includes("rate limit")) {
    return { status: "rate_limited" };
  }
  if (msg.includes("business or creator") || msg.includes("not a business") || msg.includes("professional")) {
    return { status: "not_professional" };
  }
  if (msg.includes("does not exist") || msg.includes("cannot find") || msg.includes("invalid user")) {
    return { status: "not_found" };
  }
  // code 100 genérico sin pista clara: lo más común es objetivo no-profesional o inexistente.
  // Lo tratamos como skip (not_found) para no abortar el run por un lead.
  return { status: "not_found" };
}

const FIELDS =
  "business_discovery.username(%USERNAME%){username,name,biography,followers_count,follows_count,media_count,website,media.limit(6){caption,timestamp,like_count,comments_count}}";

function toNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseProfile(bd: Record<string, unknown>): GraphBusinessProfile {
  const mediaData = ((bd["media"] as { data?: unknown[] } | undefined)?.data ?? []) as Array<Record<string, unknown>>;
  return {
    username: typeof bd["username"] === "string" ? bd["username"] : null,
    name: typeof bd["name"] === "string" ? bd["name"] : null,
    biography: typeof bd["biography"] === "string" ? bd["biography"] : null,
    followers_count: toNumber(bd["followers_count"]),
    follows_count: toNumber(bd["follows_count"]),
    media_count: toNumber(bd["media_count"]),
    website: typeof bd["website"] === "string" ? bd["website"] : null,
    recent_media: mediaData.map((m) => ({
      caption: typeof m["caption"] === "string" ? m["caption"] : null,
      timestamp: typeof m["timestamp"] === "string" ? m["timestamp"] : null,
      like_count: toNumber(m["like_count"]),
      comments_count: toNumber(m["comments_count"]),
    })),
  };
}

export async function lookupInstagramBusiness(
  username: string,
  opts: { timeoutMs?: number } = {}
): Promise<GraphLookupResult> {
  if (!isGraphApiEnabled()) return { status: "disabled" };

  const igUserId = (process.env["META_IG_USER_ID"] ?? "").trim();
  const token = (process.env["META_GRAPH_TOKEN"] ?? "").trim();
  const version = (process.env["META_GRAPH_VERSION"] ?? DEFAULT_VERSION).trim();
  const baseUrl = (process.env["META_GRAPH_BASE_URL"] ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

  const fields = FIELDS.replace("%USERNAME%", username);
  const url = `${baseUrl}/${version}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (body["error"]) {
      return classifyError(body["error"] as { code?: number; message?: string });
    }
    const bd = body["business_discovery"] as Record<string, unknown> | undefined;
    if (!bd) {
      // 2xx sin business_discovery: respuesta inesperada → skip.
      return { status: "error", message: "missing business_discovery in response" };
    }
    return { status: "ok", profile: parseProfile(bd) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Timeout/red: recuperable, se trata como skip best-effort (el caller puede reintentar).
    return { status: "error", message };
  } finally {
    clearTimeout(timer);
  }
}
