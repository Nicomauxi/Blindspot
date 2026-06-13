// Provider Serper.dev (Google SERP API). Una sola query por lead trae, del índice de
// Google: la URL del perfil de IG + el og:description con "15K followers · 714 following ·
// 303 posts" + bio/teléfonos. Resuelve descubrimiento Y métricas en 1 crédito, sin el
// rate-limit por-IP de scrapear buscadores (Serper rota IPs por nosotros). Gateado por
// SERPER_API_KEY: sin key, el pipeline cae al path SearXNG ($0 local).
import { buildQuery } from "../enrichment/social-search.js";
import { selectProfileFromResults, type SearxngSearchResult } from "./social-discover-searxng.js";
import { parseInstagramProfileRich } from "./duckduckgo-snippet.js";
import type { Lead, SocialSearchPlatformResult } from "../../shared/types.js";
import type { SocialProfileData } from "./social-fusion.js";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SERPER_TIMEOUT_MS = 12_000;

export function serperConfigured(): boolean {
  return Boolean(process.env["SERPER_API_KEY"]?.trim());
}

interface SerperOrganic {
  link?: string;
  title?: string;
  snippet?: string;
}

// Una query a Serper → resultados orgánicos normalizados a la forma {url,title,content}.
// Cuenta 1 crédito. Degrada a [] ante error (el caller lo trata como "sin resultados").
export async function serperSearch(
  query: string,
  opts: { fetchImpl?: typeof fetch; num?: number } = {}
): Promise<SearxngSearchResult[]> {
  const key = process.env["SERPER_API_KEY"]?.trim();
  if (!key) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "uy", hl: "es", num: opts.num ?? 10 }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { organic?: SerperOrganic[] };
    return (json.organic ?? []).map((o) => {
      const r: SearxngSearchResult = {};
      if (o.link) r.url = o.link;
      if (o.title) r.title = o.title;
      if (o.snippet) r.content = o.snippet;
      return r;
    });
  } catch {
    return [];
  }
}

export interface SerperLeadResult {
  instagram: SocialSearchPlatformResult;
  /** Métricas extraídas del MISMO set de resultados (sin query extra). null si no hay snippet con followers. */
  metrics: SocialProfileData | null;
  igUsername: string | null;
}

function usernameFromProfileUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean);
    return seg[0] ?? null;
  } catch {
    return null;
  }
}

// Google indexa en el snippet un post CUALQUIERA (no necesariamente el último): los reels
// nuevos no traen el formato "N likes - handle on DATE", así que extractRecentMedia suele
// captar posts viejos. Por eso la actividad de SERP solo vale como señal POSITIVA: si hay un
// post RECIENTE (≤180 días), es evidencia de cuenta activa; si solo hay posts viejos, NO
// concluimos "abandonada" (no vemos el último) → se descartan los timestamps para no derivar
// un falso "abandoned" en el scoring. Engagement (likes/comments) se conserva.
const ACTIVE_WINDOW_DAYS = 180;
// Techo de followers para un negocio LOCAL uruguayo. Por encima, el match es casi seguro
// una cuenta global homónima (nombres cortos: "Olivia"→oliviarodrigo 40M; "Soho"→sohohouse
// 461K). Un SMB de barrio no tiene cientos de miles de seguidores → se rechaza el match.
const MAX_LOCAL_FOLLOWERS = 150_000;

function sanitizeStaleLiveness(profile: SocialProfileData, nowMs: number): SocialProfileData {
  const cutoff = nowMs - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const newest = profile.recent_media
    .map((m) => (m.timestamp ? Date.parse(m.timestamp) : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];
  if (newest != null && newest >= cutoff) return profile; // post reciente → liveness confiable
  // Solo posts viejos (o ninguno): DESCARTAR recent_media por completo. Mantenerla (aun sin
  // timestamp) haría que buildSocialFusion vea "hay posts sin fecha reciente" → falso
  // 'abandoned'. Sin recent_media → liveness 'unknown' (honesto: no vemos el último post).
  return { ...profile, recent_media: [] };
}

// ¿El perfil tiene ALGO útil tras sanear? (followers reales o actividad reciente). Si no,
// es solo una URL → no vale como "métricas".
function profileHasUsableMetrics(profile: SocialProfileData): boolean {
  return profile.followers_count != null || profile.recent_media.length > 0;
}

// Descubre el perfil IG + extrae métricas de Serper.
// - Query 1 (name-based): descubre la URL + métricas oportunistas (1 crédito).
// - Fallback (opt, default ON): si hay perfil pero la query 1 no trajo followers, UNA query
//   dirigida `instagram.com/<handle>` (solo para perfiles YA confirmados) maximiza la
//   captura de métricas. Cuesta 1 crédito extra solo en ese subconjunto.
export async function discoverEnrichViaSerper(
  lead: Pick<Lead, "name" | "address">,
  opts: { fetchImpl?: typeof fetch; metricsFallback?: boolean; nowMs?: number } = {}
): Promise<SerperLeadResult> {
  const query = buildQuery("instagram", lead);
  const raw = await serperSearch(query, opts);
  const instagram = selectProfileFromResults(raw, lead, "instagram", query);
  const igUsername = usernameFromProfileUrl(instagram.best_url);

  let metrics = igUsername
    ? parseInstagramProfileRich(raw.map((r) => r.content ?? "").filter(Boolean), igUsername)
    : null;

  // Fallback dirigido: perfil confirmado pero sin métricas en la query 1.
  if (!metrics && igUsername && (opts.metricsFallback ?? true)) {
    const raw2 = await serperSearch(`instagram.com/${igUsername}`, opts);
    metrics = parseInstagramProfileRich(raw2.map((r) => r.content ?? "").filter(Boolean), igUsername);
  }

  // Guard de cuenta global homónima: followers implausibles para un local UY → falso match.
  // Se descarta TODO (URL + métricas): no es el negocio. Catch principal de los falsos
  // positivos de nombres cortos (Olivia→oliviarodrigo, Soho→sohohouse).
  if (metrics?.followers_count != null && metrics.followers_count > MAX_LOCAL_FOLLOWERS) {
    return {
      instagram: { ...instagram, best_url: null, confidence: 0 },
      metrics: null,
      igUsername: null,
    };
  }

  if (metrics) {
    metrics = sanitizeStaleLiveness(metrics, opts.nowMs ?? Date.now());
    if (!profileHasUsableMetrics(metrics)) metrics = null; // solo URL → no cuenta como métricas
  }

  return { instagram, metrics, igUsername };
}
