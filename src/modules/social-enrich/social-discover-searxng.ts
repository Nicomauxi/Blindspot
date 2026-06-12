// F1: descubrimiento social vía SearXNG (gratis, $0). Encuentra el perfil de IG/FB de
// un negocio buscando `site:instagram.com "<nombre>" <ciudad>` en SearXNG y puntuando los
// resultados con el MISMO scorer que el path DDG (reusado), que está muerto en prod.
//
// A diferencia de ig-snippet-enrich (que enriquece una IG YA seleccionada), esto DESCUBRE
// el perfil para leads digital-dark (sin web ni social). Es la ruta que ataca los ~1771.
import {
  buildQuery,
  scoreResult,
  selectBest,
} from "../enrichment/social-search.js";
import type {
  DuckDuckGoSocialSearch,
  Lead,
  SocialSearchPlatform,
  SocialSearchPlatformResult,
} from "../../shared/types.js";

const DEFAULT_SEARXNG_URL = "http://localhost:8080";
const SEARXNG_TIMEOUT_MS = 8000;

export interface SearxngSearchResult {
  url?: string;
  title?: string;
  content?: string;
}

export interface SocialDiscoverDeps {
  search: (query: string) => Promise<SearxngSearchResult[]>;
  delay: (ms: number) => Promise<void>;
}

async function searxngSearch(query: string, baseUrl: string, fetchImpl: typeof fetch): Promise<SearxngSearchResult[]> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARXNG_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: SearxngSearchResult[] };
    return Array.isArray(json.results) ? json.results : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function makeSearxngDeps(opts: { baseUrl?: string; throttleMs?: number; fetchImpl?: typeof fetch } = {}): SocialDiscoverDeps {
  const base = (opts.baseUrl ?? process.env["SEARXNG_URL"] ?? DEFAULT_SEARXNG_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    search: (query) => searxngSearch(query, base, fetchImpl),
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

async function discoverPlatform(
  platform: SocialSearchPlatform,
  lead: Pick<Lead, "name" | "address">,
  deps: SocialDiscoverDeps
): Promise<SocialSearchPlatformResult> {
  const query = buildQuery(platform, lead);
  const raw = await deps.search(query);
  const results = raw
    .filter((r) => typeof r.url === "string" && r.url.length > 0)
    .map((r) => scoreResult({ title: r.title ?? "", snippet: r.content ?? "", url: r.url! }, platform, lead));
  return selectBest(query, results);
}

// Descubre IG + FB de un lead vía SearXNG. throttleMs se aplica entre las dos queries
// (por-lead); la concurrencia entre leads la maneja el runner.
export async function discoverSocialViaSearxng(
  lead: Pick<Lead, "name" | "address">,
  deps: SocialDiscoverDeps,
  throttleMs = 0
): Promise<DuckDuckGoSocialSearch> {
  // Optimización: con throttle 0 las 2 queries (IG + FB) corren EN PARALELO dentro del
  // lead (≈mitad de latencia por lead). Con throttle >0 se espacian (modo anti rate-limit).
  let instagram: SocialSearchPlatformResult;
  let facebook: SocialSearchPlatformResult;
  if (throttleMs > 0) {
    instagram = await discoverPlatform("instagram", lead, deps);
    await deps.delay(throttleMs);
    facebook = await discoverPlatform("facebook", lead, deps);
  } else {
    [instagram, facebook] = await Promise.all([
      discoverPlatform("instagram", lead, deps),
      discoverPlatform("facebook", lead, deps),
    ]);
  }

  return {
    ran_at: new Date().toISOString(),
    source: "searxng",
    facebook,
    instagram,
  };
}
