import { fetch } from "undici";
import { load as loadHtml } from "cheerio";
import { getLogger } from "../../shared/logger.js";
import { getConfig } from "../../shared/config.js";
import type {
  Lead,
  SocialSearch,
  SocialSearchPlatform,
  SocialSearchPlatformResult,
  SocialSearchResult,
  SocialSearchSignal,
} from "../../shared/types.js";
import { USER_AGENT } from "./http.js";
import { deriveDirectoryCitySlug } from "./directory-discovery.js";

const THRESHOLD = 0.4;
const INTER_QUERY_DELAY_MS = 500;
const DUCKDUCKGO_HTML_URL = "https://duckduckgo.com/html/";

interface DuckDuckGoFetchResult {
  status: number | null;
  html: string | null;
  error?: string;
}

interface SocialSearchDeps {
  fetchDuckDuckGo: (url: string) => Promise<DuckDuckGoFetchResult>;
  delay: (ms: number) => Promise<void>;
}

const PLATFORM_HOSTS: Record<SocialSearchPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com", "ig.com"],
};

const DEFAULT_DEPS: SocialSearchDeps = {
  fetchDuckDuckGo: fetchDuckDuckGoHtml,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function getSocialSearchRefreshDays(): number {
  return getConfig().SOCIAL_SEARCH_REFRESH_DAYS;
}

export function isSocialSearchStale(
  discovery: SocialSearch | null | undefined,
  now = Date.now()
): boolean {
  if (!discovery?.ran_at) return true;
  if (discovery.source === "duckduckgo-fallback") return false;
  if (discovery.source === "duckduckgo") {
    const fbBlocked = !!discovery.facebook?.error;
    const igBlocked = !!discovery.instagram?.error;
    if (fbBlocked && igBlocked) return true;
  }
  const t = Date.parse(discovery.ran_at);
  if (Number.isNaN(t)) return true;
  return now - t >= getSocialSearchRefreshDays() * 24 * 60 * 60 * 1_000;
}

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(input: string | null | undefined): string {
  return asciiFold(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContains(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  return !!h && !!n && h.includes(n);
}

function nameMatches(text: string, name: string): boolean {
  if (textContains(text, name)) return true;
  const textTokens = new Set(
    normalizeText(text)
      .split(" ")
      .filter((token) => token.length > 2)
  );
  const nameTokens = normalizeText(name)
    .split(" ")
    .filter((token) => token.length > 2);
  if (nameTokens.length === 0) return false;
  const overlap = nameTokens.filter((token) => textTokens.has(token)).length;
  return overlap / nameTokens.length >= 0.5;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function buildQuery(platform: SocialSearchPlatform, lead: Pick<Lead, "name" | "address">): string {
  const city = deriveDirectoryCitySlug(lead.address);
  const site = platform === "facebook" ? "facebook.com" : "instagram.com";
  return [`site:${site}`, `"${lead.name}"`, city].filter(Boolean).join(" ");
}

function buildSearchUrl(query: string): string {
  return `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(query)}`;
}

async function fetchDuckDuckGoHtml(url: string): Promise<DuckDuckGoFetchResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.status !== 200) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      return { status: response.status, html: null, error: `http-${response.status}` };
    }
    const html = await response.text();
    return { status: response.status, html };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: null, html: null, error: `network: ${msg}` };
  }
}

function decodeDuckDuckGoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, DUCKDUCKGO_HTML_URL);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return normalizeResultUrl(uddg);
    return normalizeResultUrl(parsed.toString());
  } catch {
    return normalizeResultUrl(trimmed);
  }
}

function normalizeResultUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function platformMatches(
  url: string,
  platform: SocialSearchPlatform,
  hosts?: Record<SocialSearchPlatform, string[]>
): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const platformHosts = hosts ?? PLATFORM_HOSTS;
    return platformHosts[platform].some((expected) => host === expected || host.endsWith(`.${expected}`));
  } catch {
    return false;
  }
}

export function normalizeUruguayPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("5980")) digits = `598${digits.slice(4)}`;
  if (digits.startsWith("0") && digits.length === 9) digits = `598${digits.slice(1)}`;
  if (digits.length === 8) digits = `598${digits}`;
  if (!digits.startsWith("598")) return null;
  const local = digits.slice(3);
  if (!/^[29]\d{6,7}$/.test(local)) return null;
  return `+${digits}`;
}

export function isUruguayMobilePhone(phone: string): boolean {
  const normalized = normalizeUruguayPhone(phone);
  return normalized !== null && /^\+5989\d{7}$/.test(normalized);
}

function extractUruguayPhones(text: string): string[] {
  const matches = text.match(/\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b/g) ?? [];
  const normalized = matches
    .map((match) => normalizeUruguayPhone(match))
    .filter((phone): phone is string => phone !== null);
  return Array.from(new Set(normalized));
}

export function scoreResult(
  result: Omit<SocialSearchResult, "score" | "signals" | "phones_found">,
  platform: SocialSearchPlatform,
  lead: Pick<Lead, "name" | "address">
): SocialSearchResult {
  const signals: SocialSearchSignal[] = [];
  let score = 0;
  const city = deriveDirectoryCitySlug(lead.address);
  const phones = extractUruguayPhones(result.snippet);

  if (nameMatches(result.title, lead.name)) {
    signals.push("name_in_title");
    score += 0.4;
  }
  if (nameMatches(result.snippet, lead.name)) {
    signals.push("name_in_snippet");
    score += 0.25;
  }
  if (city && textContains(result.snippet, city)) {
    signals.push("city_in_snippet");
    score += 0.2;
  }
  if (phones.length > 0) {
    signals.push("phone_in_snippet");
    score += 0.15;
  }
  if (platformMatches(result.url, platform)) {
    signals.push("url_matches_platform");
    score += 0.1;
  }

  return {
    ...result,
    score: Number(score.toFixed(2)),
    signals,
    phones_found: phones,
  };
}

function parseResults(
  html: string,
  platform: SocialSearchPlatform,
  lead: Pick<Lead, "name" | "address">
): SocialSearchResult[] {
  const $ = loadHtml(html);
  const results: SocialSearchResult[] = [];

  $(".result").each((_index, element) => {
    const root = $(element);
    const title = cleanText(root.find(".result__title").text() || root.find(".result__a").text());
    const snippet = cleanText(root.find(".result__snippet").text());
    const rawHref = root.find(".result__a").attr("href") ?? "";
    const rawUrlText = cleanText(root.find(".result__url").text());
    const url = decodeDuckDuckGoUrl(rawHref) ?? normalizeResultUrl(rawUrlText);
    if (!title || !url) return;
    results.push(scoreResult({ title, snippet, url }, platform, lead));
  });

  return results;
}

function emptyPlatformResult(query: string, error?: string): SocialSearchPlatformResult {
  return {
    query,
    results: [],
    best_url: null,
    additional_phones: [],
    confidence: 0,
    ...(error ? { error } : {}),
  };
}

export function selectBest(query: string, results: SocialSearchResult[]): SocialSearchPlatformResult {
  const best = [...results].sort((a, b) => b.score - a.score)[0] ?? null;
  const selected =
    best && best.score >= THRESHOLD && best.signals.includes("name_in_title")
      ? best
      : null;
  const phones = selected ? selected.phones_found : [];
  return {
    query,
    results,
    best_url: selected?.url ?? null,
    additional_phones: phones,
    confidence: selected?.score ?? 0,
  };
}

async function discoverPlatform(
  platform: SocialSearchPlatform,
  lead: Pick<Lead, "name" | "address">,
  deps: SocialSearchDeps
): Promise<SocialSearchPlatformResult> {
  const query = buildQuery(platform, lead);
  const url = buildSearchUrl(query);
  let fetched: DuckDuckGoFetchResult;

  try {
    fetched = await deps.fetchDuckDuckGo(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ platform, query, err: msg }, "social search unavailable");
    return emptyPlatformResult(query, `network: ${msg}`);
  }

  if (fetched.error || fetched.status !== 200 || !fetched.html?.trim()) {
    const error = fetched.error ?? (fetched.status !== null ? `http-${fetched.status}` : "empty-html");
    getLogger().warn({ platform, query, status: fetched.status, error }, "social search unavailable");
    return emptyPlatformResult(query, error);
  }

  try {
    const results = parseResults(fetched.html, platform, lead);
    if (results.length === 0) {
      getLogger().warn({ platform, query }, "social search returned no results");
    }
    return selectBest(query, results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ platform, query, err: msg }, "social search parse failure");
    return emptyPlatformResult(query, msg);
  }
}

// F4.2: el path social vía DuckDuckGo está muerto en producción (DDG bloquea las consultas
// automáticas). El path vivo es ig-snippet-enrich (SearXNG), invocado por su propio comando.
// Por defecto este discover NO hace red — se habilita explícitamente con ENABLE_DDG_SOCIAL_SEARCH.
function ddgSocialSearchEnabled(): boolean {
  const raw = process.env["ENABLE_DDG_SOCIAL_SEARCH"];
  return raw === "1" || raw === "true";
}

export async function discoverSocialSearch(
  lead: Pick<Lead, "name" | "address">,
  depsOverrides: Partial<SocialSearchDeps> = {}
): Promise<SocialSearch> {
  if (!ddgSocialSearchEnabled()) {
    // Sin red: resultado vacío marcado como fallback (el enrich lo trata como "no corrió").
    return {
      ran_at: new Date().toISOString(),
      source: "duckduckgo-fallback",
      facebook: emptyPlatformResult(buildQuery("facebook", lead), "ddg-disabled"),
      instagram: emptyPlatformResult(buildQuery("instagram", lead), "ddg-disabled"),
    };
  }
  const deps: SocialSearchDeps = { ...DEFAULT_DEPS, ...depsOverrides };
  const facebook = await discoverPlatform("facebook", lead, deps);
  await deps.delay(INTER_QUERY_DELAY_MS);
  const instagram = await discoverPlatform("instagram", lead, deps);

  const bothBlocked = !!facebook.error && !!instagram.error;
  return {
    ran_at: new Date().toISOString(),
    source: bothBlocked ? "duckduckgo-fallback" : "duckduckgo",
    facebook,
    instagram,
  };
}
