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
import { SearxngPool } from "./searxng-pool.js";

const DEFAULT_SEARXNG_URL = "http://localhost:8080";
const SEARXNG_TIMEOUT_MS = 8000;
// Engines RESILIENTES medidos para queries site:instagram.com (2026-06): qwant y yandex
// responden con perfiles + followers y NO ponen CAPTCHA. Google/Brave/DDG/Startpage/Mojeek
// suspenden nuestra IP (cascada de suspensión que colapsa el hit-rate). Fijar los buenos
// estabiliza el hit-rate sin restart de contenedor. Override: SEARXNG_ENGINES.
const DEFAULT_ENGINES = "qwant,yandex";

export interface SearxngSearchResult {
  url?: string;
  title?: string;
  content?: string;
}

// Segmentos que NO son un handle de perfil (son contenido o páginas de sistema).
const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "tv", "stories", "accounts", "directory", "about", "web", "developer", "legal", "privacy"]);
const FB_RESERVED = new Set(["posts", "photos", "photo", "videos", "video", "watch", "events", "event", "groups", "marketplace", "media", "reel", "story.php", "permalink.php", "sharer", "sharer.php", "login", "help", "pages"]);

// Devuelve la URL CANÓNICA del perfil (instagram.com/<handle>/) si la URL apunta a un
// perfil o a una subpágina de perfil (/<handle>/reels/), o null si es contenido (/p/,
// /reel/, /explore/) o de sistema. Clave para no guardar posts sueltos como "el perfil".
export function extractProfileUrl(rawUrl: string, platform: SocialSearchPlatform): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const seg = parsed.pathname.split("/").filter(Boolean);
  if (seg.length === 0) return null;

  if (platform === "instagram") {
    if (!host.endsWith("instagram.com")) return null;
    const handle = seg[0]!.toLowerCase();
    if (IG_RESERVED.has(handle)) return null;
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null;
    return `https://www.instagram.com/${handle}/`;
  }
  // facebook
  if (!host.endsWith("facebook.com") && !host.endsWith("fb.com")) return null;
  const first = seg[0]!.toLowerCase();
  if (FB_RESERVED.has(first)) return null;
  if (first === "profile.php") {
    const id = parsed.searchParams.get("id");
    return id ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  if (!/^[a-z0-9.\-]{2,}$/.test(first)) return null;
  return `https://www.facebook.com/${seg[0]}/`;
}

export interface SocialDiscoverDeps {
  search: (query: string) => Promise<SearxngSearchResult[]>;
  delay: (ms: number) => Promise<void>;
}

interface SearxngResponse {
  results: SearxngSearchResult[];
  /** engines pedidos que no respondieron (rate-limit/CAPTCHA) → señal de IP throttleada. */
  unresponsive: string[];
}

async function searxngSearch(query: string, baseUrl: string, fetchImpl: typeof fetch): Promise<SearxngResponse> {
  const engines = process.env["SEARXNG_ENGINES"] ?? DEFAULT_ENGINES;
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=${encodeURIComponent(engines)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARXNG_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return { results: [], unresponsive: [] };
    const json = (await res.json()) as { results?: SearxngSearchResult[]; unresponsive_engines?: unknown[] };
    const unresponsive = Array.isArray(json.unresponsive_engines)
      ? json.unresponsive_engines.map((u) => (Array.isArray(u) ? String(u[0]) : String(u)))
      : [];
    return { results: Array.isArray(json.results) ? json.results : [], unresponsive };
  } catch {
    return { results: [], unresponsive: [] };
  } finally {
    clearTimeout(timer);
  }
}

// (b) Pool multi-instancia: reparte queries round-robin entre las URLs de SEARXNG_URLS
// (cada una con IP de salida distinta) y pone en cooldown la instancia cuya IP está
// throttleada (todos los engines pedidos unresponsive). Con una sola URL = instancia única.
export function makeSearxngDeps(opts: { baseUrl?: string; throttleMs?: number; fetchImpl?: typeof fetch; pool?: SearxngPool } = {}): SocialDiscoverDeps {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pool = opts.pool ?? (opts.baseUrl ? new SearxngPool([opts.baseUrl.replace(/\/+$/, "")]) : SearxngPool.fromEnv());
  const requestedEngines = (process.env["SEARXNG_ENGINES"] ?? DEFAULT_ENGINES).split(",").map((e) => e.trim());
  return {
    search: async (query) => {
      const instance = pool.next();
      const { results, unresponsive } = await searxngSearch(query, instance.url, fetchImpl);
      // Si TODOS los engines pedidos quedaron unresponsive, esa IP está quemada → cooldown.
      const allDown = requestedEngines.length > 0 && requestedEngines.every((e) => unresponsive.includes(e));
      if (allDown) pool.markThrottled(instance.url);
      return results;
    },
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function normalizeAlnum(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function profileHandle(profileUrl: string): string {
  try {
    const seg = new URL(profileUrl).pathname.split("/").filter(Boolean);
    if (seg[0] === "profile.php") return new URL(profileUrl).searchParams.get("id") ?? "";
    return seg[0] ?? "";
  } catch {
    return "";
  }
}

// El handle del perfil "se parece" al nombre del negocio. Clave para engines como yandex
// que devuelven la URL correcta pero SIN título/snippet usable (el scorer por-snippet falla).
// clearbarberia ≈ "CLEAR barberia"; barberia_black_jack_uruguay ⊇ "Barberia Black jack".
export function handleMatchesName(profileUrl: string, name: string): boolean {
  const handle = normalizeAlnum(profileHandle(profileUrl));
  const n = normalizeAlnum(name);
  if (handle.length < 4 || n.length < 4) return false;
  return handle.includes(n) || n.includes(handle);
}

const DISCOVERY_THRESHOLD = 0.4;

// Selección pura (sin red): de los resultados crudos de un buscador, elige el mejor perfil.
// Reusada por SearXNG y Serper. `query` es solo etiqueta para trazabilidad.
export function selectProfileFromResults(
  raw: SearxngSearchResult[],
  lead: Pick<Lead, "name" | "address">,
  platform: SocialSearchPlatform,
  query = ""
): SocialSearchPlatformResult {
  const scored = raw
    .filter((r) => typeof r.url === "string" && r.url.length > 0)
    // Normalizar a URL de PERFIL y descartar contenido (/p/, /reel/, /explore/). Sin esto
    // ~64% de los "hits" eran posts sueltos, inservibles para identidad/followers del negocio.
    .map((r) => ({ r, profile: extractProfileUrl(r.url!, platform) }))
    .filter((x): x is { r: SearxngSearchResult; profile: string } => x.profile !== null)
    .map(({ r, profile }) => {
      const result = scoreResult({ title: r.title ?? "", snippet: r.content ?? "", url: profile }, platform, lead);
      // handle_match: rescata engines sin snippet (yandex devuelve la URL correcta pero
      // título/contenido vacíos). SOLO instagram: los handles de IG son identidad limpia;
      // los de FB son ruidosos (ej. "dragonchinoecija" = otro negocio en España). FB sigue
      // exigiendo match por snippet (name_in_title).
      const handleMatch = platform === "instagram" && handleMatchesName(profile, lead.name);
      const score = handleMatch ? Number(Math.min(1, result.score + 0.6).toFixed(2)) : result.score;
      return { result: { ...result, score }, handleMatch };
    });

  // Aceptar si hay name_in_title (snippet rico) O handle_match (URL confiable sin snippet).
  const eligible = scored.filter(
    ({ result, handleMatch }) => result.score >= DISCOVERY_THRESHOLD && (result.signals.includes("name_in_title") || handleMatch)
  );
  const best = [...eligible].sort((a, b) => b.result.score - a.result.score)[0] ?? null;
  return {
    query,
    results: scored.map((s) => s.result),
    best_url: best?.result.url ?? null,
    additional_phones: best?.result.phones_found ?? [],
    confidence: best?.result.score ?? 0,
  };
}

async function discoverPlatform(
  platform: SocialSearchPlatform,
  lead: Pick<Lead, "name" | "address">,
  deps: SocialDiscoverDeps
): Promise<SocialSearchPlatformResult> {
  const query = buildQuery(platform, lead);
  const raw = await deps.search(query);
  return selectProfileFromResults(raw, lead, platform, query);
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
