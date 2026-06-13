// Provider Serper.dev (Google SERP API). Una sola query por lead trae, del índice de
// Google: la URL del perfil de IG + el og:description con "15K followers · 714 following ·
// 303 posts" + bio/teléfonos. Resuelve descubrimiento Y métricas en 1 crédito, sin el
// rate-limit por-IP de scrapear buscadores (Serper rota IPs por nosotros). Gateado por
// SERPER_API_KEY: sin key, el pipeline cae al path SearXNG ($0 local).
import { getLogger } from "../../shared/logger.js";
import { buildQuery } from "../enrichment/social-search.js";
import { selectProfileFromResults, type SearxngSearchResult } from "./social-discover-searxng.js";
import { parseInstagramProfileRich } from "./duckduckgo-snippet.js";
import { getSerperKeys, type SerperBudget } from "./serper-budget.js";
import type { Lead, SocialSearchPlatformResult } from "../../shared/types.js";
import type { SocialProfileData } from "./social-fusion.js";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SERPER_TIMEOUT_MS = 12_000;

export function serperConfigured(): boolean {
  return getSerperKeys().length > 0;
}

interface SerperOrganic {
  link?: string;
  title?: string;
  snippet?: string;
  rating?: number;
  ratingCount?: number;
}

interface SerperSearchOpts {
  fetchImpl?: typeof fetch;
  num?: number;
  budget?: SerperBudget; // si se provee, gestiona key activa + rotación + contador
}

// Core: 1 query a Serper → organic crudo. Cuenta 1 crédito. Con budget, usa la key activa,
// cuenta la query y rota ante 429/402/403 (cuota agotada), reintentando por key. Sin budget,
// usa la primera key del entorno (compat/tests). Degrada a [] ante error de red/parse.
const RATE_LIMIT_RETRIES = 4;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// FS-11: fetchError distingue "no pudimos consultar" (429 persistente / !ok / red-timeout)
// de un resultado vacío legítimo (200 sin organic). Sin esto, un error transitorio se contaba
// como no_match ("este negocio no tiene IG") y sobre-estimaba los digital-dark.
type RunOutcome = { organic: SerperOrganic[]; quotaExhausted: boolean; fetchError: boolean };
export interface SerperOrganicStatus { organic: SerperOrganic[]; fetchError: boolean }

export async function serperOrganicStatus(query: string, opts: SerperSearchOpts = {}): Promise<SerperOrganicStatus> {
  const doFetch = opts.fetchImpl ?? fetch;
  const budget = opts.budget;

  // Una key: maneja el 429 TRANSITORIO (rate-limit por burst de concurrencia) con backoff +
  // reintento de la MISMA key. Solo 402/403 = cuota/credenciales agotadas (rotar). Un 429
  // persistente tras los reintentos → falla la query (no marca la key muerta).
  const runKey = async (key: string): Promise<RunOutcome> => {
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
      try {
        const res = await doFetch(SERPER_ENDPOINT, {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, gl: "uy", hl: "es", num: opts.num ?? 10 }),
          signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
        });
        if (res.status === 402 || res.status === 403) return { organic: [], quotaExhausted: true, fetchError: false };
        if (res.status === 429) {
          if (attempt < RATE_LIMIT_RETRIES) { await sleep(300 * (attempt + 1)); continue; } // backoff
          return { organic: [], quotaExhausted: false, fetchError: true }; // 429 persistente → no pudimos consultar
        }
        if (!res.ok) return { organic: [], quotaExhausted: false, fetchError: true };
        const json = (await res.json()) as { organic?: SerperOrganic[] };
        return { organic: json.organic ?? [], quotaExhausted: false, fetchError: false };
      } catch (err) {
        getLogger().warn({ query, err: String(err) }, "serper fetch error (transitorio)");
        return { organic: [], quotaExhausted: false, fetchError: true };
      }
    }
    return { organic: [], quotaExhausted: false, fetchError: true };
  };

  if (!budget) {
    const key = getSerperKeys()[0];
    if (!key) return { organic: [], fetchError: false };
    const { organic, fetchError } = await runKey(key);
    return { organic, fetchError };
  }
  for (;;) {
    const key = budget.activeKey();
    if (!key) return { organic: [], fetchError: false }; // tope o todas las keys agotadas (no es fetch error)
    budget.recordQuery();
    const { organic, quotaExhausted, fetchError } = await runKey(key);
    if (quotaExhausted) {
      budget.markExhausted(key); // 402/403 → esta key sin créditos → rotar
      continue;
    }
    return { organic, fetchError };
  }
}

export async function serperOrganic(query: string, opts: SerperSearchOpts = {}): Promise<SerperOrganic[]> {
  return (await serperOrganicStatus(query, opts)).organic;
}

function toSearxngResults(organic: SerperOrganic[]): SearxngSearchResult[] {
  return organic.map((o) => {
    const r: SearxngSearchResult = {};
    if (o.link) r.url = o.link;
    if (o.title) r.title = o.title;
    if (o.snippet) r.content = o.snippet;
    return r;
  });
}

// Forma SearXNG {url,title,content} para el path de discovery social existente.
export async function serperSearch(query: string, opts: SerperSearchOpts = {}): Promise<SearxngSearchResult[]> {
  return toSearxngResults(await serperOrganic(query, opts));
}

export async function serperSearchWithStatus(
  query: string,
  opts: SerperSearchOpts = {}
): Promise<{ results: SearxngSearchResult[]; fetchError: boolean }> {
  const { organic, fetchError } = await serperOrganicStatus(query, opts);
  return { results: toSearxngResults(organic), fetchError };
}

export interface SerperLeadResult {
  instagram: SocialSearchPlatformResult;
  /** Métricas extraídas del MISMO set de resultados (sin query extra). null si no hay snippet con followers. */
  metrics: SocialProfileData | null;
  igUsername: string | null;
  /** FS-11: true si la query 1 falló por error transitorio (no es "sin IG", es "no pudimos consultar"). */
  fetchError: boolean;
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
  opts: { fetchImpl?: typeof fetch; metricsFallback?: boolean; nowMs?: number; budget?: SerperBudget } = {}
): Promise<SerperLeadResult> {
  const query = buildQuery("instagram", lead);
  const { results: raw, fetchError } = await serperSearchWithStatus(query, opts);
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
      fetchError,
    };
  }

  if (metrics) {
    metrics = sanitizeStaleLiveness(metrics, opts.nowMs ?? Date.now());
    if (!profileHasUsableMetrics(metrics)) metrics = null; // solo URL → no cuenta como métricas
  }

  return { instagram, metrics, igUsername, fetchError };
}

// ─── Fase 2: query unificada (1 crédito → website + social + reviews-meta) ──────────────

// Dominios que NO son el sitio propio del negocio: redes, agregadores/directorios, mapas,
// reseñas. Backstop; el filtro principal es la afinidad dominio↔nombre (abajo).
const NON_OWN_SITE_RE = /(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com|linktree|youtube|youtu\.be|tripadvisor|yelp|booking\.com|foursquare|google\.|goo\.gl|waze|maptons|saliracomer|alacarta|guiaost|mercadolibre|paginasamarillas|guialocal|cylex|opentable|booksy|pedidosya|rappi|wikipedia|maps\.app|gps\.|gpsmycity|restaurants-us|restaurantes-uy|restaurantguru)/i;

function normalizeAlnumLocal(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// El dominio "se parece" al nombre del negocio (floreal.com.uy ⊃ "Floreal Restaurante").
// Mismo principio que handleMatchesName (IG): evita que un directorio que rankea por el
// nombre se confunda con el sitio propio. Token-overlap o substring del label raíz.
function domainMatchesName(host: string, name: string): boolean {
  const root = host.replace(/^www\./, "").split(".")[0] ?? ""; // "floreal" de floreal.com.uy
  const d = normalizeAlnumLocal(root);
  const n = normalizeAlnumLocal(name);
  if (d.length < 4 || n.length < 4) return false;
  // SOLO substring (dominio⊃nombre o nombre⊃dominio). El token-overlap por palabra suelta
  // daba falsos positivos en términos genéricos ("cafe"/"bar" → cultocafe ≠ Rio Cafe).
  return d.includes(n) || n.includes(d);
}

// Sitio PROPIO del negocio: primer orgánico no-social/no-directorio cuyo dominio se parece
// al nombre. Si ninguno matchea → null (mejor sin web que un directorio falso).
export function pickRealWebsite(organic: SerperOrganic[], name: string): string | null {
  for (const o of organic) {
    if (!o.link) continue;
    let host: string;
    try {
      host = new URL(o.link).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (NON_OWN_SITE_RE.test(host)) continue;
    if (!domainMatchesName(host, name)) continue;
    return `https://${host.replace(/^www\./, "")}/`;
  }
  return null;
}

// Reviews-meta: del organic, tomar el resultado con MÁS ratingCount (el más representativo).
// Es rating de agregadores (TripAdvisor, etc.), señal SUPLEMENTARIA — no pisa el de Google.
export function pickReviewMeta(organic: SerperOrganic[]): { rating: number; review_count: number } | null {
  let best: { rating: number; review_count: number } | null = null;
  for (const o of organic) {
    if (typeof o.rating === "number" && typeof o.ratingCount === "number" && o.ratingCount > 0) {
      if (!best || o.ratingCount > best.review_count) best = { rating: o.rating, review_count: o.ratingCount };
    }
  }
  return best;
}

export interface UnifiedLeadResult {
  website: string | null;
  instagram: SocialSearchPlatformResult;
  facebook_url: string | null;
  metrics: SocialProfileData | null;
  igUsername: string | null;
  review_meta: { rating: number; review_count: number } | null;
}

// 1 query `<nombre> <ciudad> uruguay` → website propio + perfil IG (+métricas del snippet) +
// FB + reviews-meta. Máxima data por crédito. Reusa los guards de discoverEnrichViaSerper.
export async function unifiedLeadLookup(
  lead: Pick<Lead, "name" | "address">,
  opts: { fetchImpl?: typeof fetch; budget?: SerperBudget; nowMs?: number } = {}
): Promise<UnifiedLeadResult> {
  const city = (lead.address ?? "").split(",")[0]?.trim() ?? "";
  const query = `${lead.name} ${city} uruguay`.trim();
  const organic = await serperOrganic(query, opts);

  const website = pickRealWebsite(organic, lead.name);
  const review_meta = pickReviewMeta(organic);
  const asSearxng = toSearxngResults(organic);

  const instagram = selectProfileFromResults(asSearxng, lead, "instagram", query);
  const facebook = selectProfileFromResults(asSearxng, lead, "facebook", query);
  const igUsername = usernameFromProfileUrl(instagram.best_url);

  let metrics = igUsername
    ? parseInstagramProfileRich(asSearxng.map((r) => r.content ?? "").filter(Boolean), igUsername)
    : null;
  if (metrics?.followers_count != null && metrics.followers_count > MAX_LOCAL_FOLLOWERS) {
    // cuenta global homónima → descartar IG (no el website/reviews, que vienen de otra señal)
    return {
      website,
      instagram: { ...instagram, best_url: null, confidence: 0 },
      facebook_url: facebook.best_url,
      metrics: null,
      igUsername: null,
      review_meta,
    };
  }
  if (metrics) {
    metrics = sanitizeStaleLiveness(metrics, opts.nowMs ?? Date.now());
    if (!profileHasUsableMetrics(metrics)) metrics = null;
  }

  return { website, instagram, facebook_url: facebook.best_url, metrics, igUsername, review_meta };
}
