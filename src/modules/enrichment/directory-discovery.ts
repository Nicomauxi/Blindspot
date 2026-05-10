import { readFileSync } from "fs";
import { load as loadHtml } from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import { load } from "js-yaml";
import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import type {
  DirectoryCandidate,
  DirectoryDiscovery,
  DirectorySignal,
  Lead,
} from "../../shared/types.js";
import { fetchHtml, type FetchHtmlResult } from "./http.js";

const DEFAULT_REFRESH_DAYS = 30;
const SOURCE = "yelu.uy" as const;
const BASE_URL = `https://www.${SOURCE}`;

const DEFAULT_NICHE_CATEGORY_MAP: Record<string, string | null> = {
  hairdresser: "Peluqueros",
  car_dealer: "Concesionarios_de_Autos",
  gym: "Gimnasios",
  restaurant: "Restaurantes",
  accommodation: "Hoteles",
  pharmacy: "Farmacias",
  grocery: "Supermercados",
  dentist: "Dentistas",
  healthcare: "Medicos",
  other: null,
};

const DEFAULT_DIRECTORY_CONFIG = {
  enabled: false,
  source: SOURCE,
  min_confidence_to_use: 60,
  fetch_profile_page: true,
  niche_category_map: DEFAULT_NICHE_CATEGORY_MAP,
};

const DirectoryConfigSchema = z.object({
  directory_discovery: z
    .object({
      enabled: z.boolean().default(DEFAULT_DIRECTORY_CONFIG.enabled),
      source: z.literal(SOURCE).default(DEFAULT_DIRECTORY_CONFIG.source),
      min_confidence_to_use: z.number().int().min(0).max(100).default(DEFAULT_DIRECTORY_CONFIG.min_confidence_to_use),
      fetch_profile_page: z.boolean().default(DEFAULT_DIRECTORY_CONFIG.fetch_profile_page),
      niche_category_map: z.record(z.string(), z.string().nullable()).default(DEFAULT_DIRECTORY_CONFIG.niche_category_map),
    })
    .default(DEFAULT_DIRECTORY_CONFIG),
});

export type DirectoryDiscoveryConfig = z.infer<
  typeof DirectoryConfigSchema
>["directory_discovery"];

interface DirectoryDeps {
  fetchHtml: typeof fetchHtml;
}

const DEFAULT_DEPS: DirectoryDeps = { fetchHtml };
let cached: DirectoryDiscoveryConfig | null = null;

export function parseDirectoryConfig(yamlString: string): DirectoryDiscoveryConfig {
  const raw = load(yamlString) ?? {};
  const result = DirectoryConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid directory discovery config:\n${msgs}`);
  }
  return result.data.directory_discovery;
}

export function getDirectoryConfig(): DirectoryDiscoveryConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/enrichment.yaml", import.meta.url);
  cached = parseDirectoryConfig(readFileSync(yamlUrl, "utf-8"));
  return cached;
}

export function resetDirectoryConfigCache(): void {
  cached = null;
}

export function getDirectoryRefreshDays(): number {
  const raw = process.env.DIRECTORY_REFRESH_DAYS;
  if (!raw) return DEFAULT_REFRESH_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFRESH_DAYS;
}

export function isDirectoryStale(
  discovery: Pick<DirectoryDiscovery, "ran_at"> | null | undefined,
  now = Date.now()
): boolean {
  if (!discovery?.ran_at) return true;
  const t = Date.parse(discovery.ran_at);
  if (Number.isNaN(t)) return true;
  return now - t >= getDirectoryRefreshDays() * 24 * 60 * 60 * 1_000;
}

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(input: string): string {
  return asciiFold(input)
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeText(input: string | null): string {
  return asciiFold(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phoneLastSevenDigits(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-7) : null;
}

export function deriveDirectoryCitySlug(address: string | null): string | null {
  if (!address) return null;
  for (const segment of address.split(",")) {
    const folded = asciiFold(segment).toLowerCase();
    if (folded.includes("uruguay") || folded.includes("departamento de")) continue;

    const withoutPostalCode = folded.replace(/\b\d{5}\b/g, " ");
    const normalized = normalizeText(withoutPostalCode);
    if (!normalized || /\d/.test(normalized)) continue;

    const slug = slugify(normalized);
    if (slug) return slug;
  }
  return null;
}

function streetFromAddress(address: string | null): string | null {
  if (!address) return null;
  const first = address.split(",")[0] ?? "";
  const street = normalizeText(first).replace(/\b\d+\b/g, "").trim();
  return street.length >= 4 ? street : null;
}

interface DirectorySearch {
  category: string;
  city: string;
  query: string;
  firstPageUrl: string;
}

function buildSearch(
  lead: Pick<Lead, "address" | "niche">,
  config: DirectoryDiscoveryConfig
): DirectorySearch | null {
  if (!lead.niche) return null;
  const category = config.niche_category_map[lead.niche];
  if (!category) return null;

  const city = deriveDirectoryCitySlug(lead.address);
  if (!city) return null;
  const citySlug = slugify(city);
  if (!citySlug) return null;

  return {
    category,
    city: citySlug,
    query: `${category} ${citySlug}`,
    firstPageUrl: `${BASE_URL}/category/${category}/city:${citySlug}`,
  };
}

function pageUrl(search: DirectorySearch, page: 1 | 2): string {
  if (page === 1) return search.firstPageUrl;
  return `${BASE_URL}/category/${search.category}/${page}/city:${search.city}`;
}

function emptyDiscovery(query: string, error?: string): DirectoryDiscovery {
  return {
    ran_at: new Date().toISOString(),
    source: SOURCE,
    query,
    candidates: [],
    best_website: null,
    ...(error ? { error } : {}),
  };
}

function shouldReturnEmpty(fetched: FetchHtmlResult, query: string, url: string): DirectoryDiscovery | null {
  if (fetched.error || fetched.html === null || fetched.html.trim() === "") {
    getLogger().warn(
      { url, status: fetched.status, error: fetched.error ?? "empty-html" },
      "directory discovery unavailable"
    );
    return emptyDiscovery(query, fetched.error ?? "empty-html");
  }
  return null;
}

function absolutizeUrl(raw: string, baseUrl: string): string | null {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

function extractYeluSlug(rawHref: string | null, fallbackName: string | null): string {
  const fromHref = rawHref?.match(/\/company\/[^/]+\/([^/?#]+)/)?.[1];
  return fromHref ? slugify(fromHref) : slugify(fallbackName ?? "company");
}

function firstExternalWebsite(links: string[], baseUrl: string): string | null {
  for (const href of links) {
    const url = absolutizeUrl(href, baseUrl);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname.includes(SOURCE)) {
        return url;
      }
    } catch {
      // ignore malformed candidate links
    }
  }
  return null;
}

function nameMatches(resultName: string | null, leadName: string): boolean {
  const a = normalizeText(resultName);
  const b = normalizeText(leadName);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = b.split(" ").filter((token) => token.length > 2);
  if (bTokens.length === 0) return false;
  const overlap = bTokens.filter((token) => aTokens.has(token)).length;
  return overlap / bTokens.length >= 0.5;
}

function scoreCandidate(
  candidate: Omit<DirectoryCandidate, "confidence" | "signals">,
  lead: Pick<Lead, "name" | "address" | "phone">
): DirectoryCandidate {
  const signals: DirectorySignal[] = [];
  let confidence = 0;
  const leadPhone = phoneLastSevenDigits(lead.phone);
  const candidatePhone = phoneLastSevenDigits(candidate.phone);
  if (leadPhone && candidatePhone && leadPhone === candidatePhone) {
    signals.push("phone_match");
    confidence += 40;
  }

  if (nameMatches(candidate.name, lead.name)) {
    signals.push("name_match");
    confidence += 20;
  }

  const leadStreet = streetFromAddress(lead.address);
  const candidateAddress = normalizeText(candidate.address);
  if (leadStreet && candidateAddress.includes(leadStreet)) {
    signals.push("address_match");
    confidence += 25;
  }

  if (candidate.website) {
    signals.push("directory_website");
  }

  return { ...candidate, confidence, signals };
}

function extractListingPhone($: CheerioAPI, company: Cheerio<any>): string | null {
  let phone: string | null = null;
  company.find("div.s").each((_index: number, element: any) => {
    if (phone) return;
    const row = $(element);
    if (row.find("i.fa-phone").length === 0) return;
    phone = cleanText(row.find("span").first().text());
  });
  return phone;
}

function parseProfileContact(html: string, pageUrl: string): Pick<DirectoryCandidate, "website" | "email"> {
  const $ = loadHtml(html);
  const hrefs = $("a[href]")
    .toArray()
    .map((el) => String($(el).attr("href") ?? ""));
  const email = hrefs
    .find((href) => href.toLowerCase().startsWith("mailto:"))
    ?.replace(/^mailto:/i, "")
    .split("?")[0] ?? null;

  return {
    website: cleanText(firstExternalWebsite(hrefs, pageUrl)),
    email: cleanText(email),
  };
}

function parseSearchCandidates(
  html: string,
  pageUrlForResults: string,
  lead: Pick<Lead, "name" | "address" | "phone">
): DirectoryCandidate[] {
  const $ = loadHtml(html);
  const candidates: DirectoryCandidate[] = [];
  const seen = new Set<string>();

  $("div.company[data-cmpid]").each((_index, element) => {
    const company = $(element);
    const id = cleanText(company.attr("data-cmpid"));
    if (!id) return;

    const link = company.find("h3 > a").first();
    const name = cleanText(link.text());
    const rawHref = cleanText(link.attr("href"));
    const slug = extractYeluSlug(rawHref, name);
    const directoryUrl = `${BASE_URL}/company/${id}/${slug}`;
    if (seen.has(directoryUrl)) return;
    seen.add(directoryUrl);

    candidates.push(scoreCandidate({
      directory_url: directoryUrl,
      name,
      address: cleanText(company.find("div.address").first().text()),
      phone: extractListingPhone($, company),
      website: null,
      email: null,
    }, lead));
  });

  return candidates;
}

function bestCandidate(candidates: DirectoryCandidate[]): DirectoryCandidate | null {
  return [...candidates].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

export async function discoverDirectorySources(
  lead: Lead,
  deps: DirectoryDeps = DEFAULT_DEPS
): Promise<DirectoryDiscovery> {
  const config = getDirectoryConfig();
  const search = buildSearch(lead, config);
  const fallbackQuery = lead.niche ? `${lead.niche} ${deriveDirectoryCitySlug(lead.address) ?? ""}`.trim() : "";
  const query = search?.query ?? fallbackQuery;

  if (!config.enabled) return emptyDiscovery(query);
  if (!search) {
    getLogger().warn({ leadId: lead.id, niche: lead.niche, address: lead.address }, "directory discovery missing category/city");
    return emptyDiscovery(query);
  }

  const candidates: DirectoryCandidate[] = [];
  const firstUrl = pageUrl(search, 1);
  const firstFetched = await deps.fetchHtml(firstUrl);
  const firstEmpty = shouldReturnEmpty(firstFetched, search.query, firstUrl);
  if (firstEmpty) return firstEmpty;

  if (firstFetched.html !== null) {
    candidates.push(...parseSearchCandidates(firstFetched.html, firstUrl, lead));
  }

  const shouldFetchSecondPage =
    candidates.length > 20 && !candidates.some((candidate) => candidate.signals.includes("phone_match"));
  if (shouldFetchSecondPage) {
    const secondUrl = pageUrl(search, 2);
    const secondFetched = await deps.fetchHtml(secondUrl);
    const secondEmpty = shouldReturnEmpty(secondFetched, search.query, secondUrl);
    if (secondEmpty) return secondEmpty;
    if (secondFetched.html !== null) {
      candidates.push(...parseSearchCandidates(secondFetched.html, secondUrl, lead));
    }
  }

  if (candidates.length === 0) {
    getLogger().warn({ url: firstUrl }, "directory discovery found no parseable candidates");
    return emptyDiscovery(search.query, "unexpected-structure");
  }

  const best = bestCandidate(candidates);
  if (best && best.confidence >= config.min_confidence_to_use && config.fetch_profile_page) {
    const profile = await deps.fetchHtml(best.directory_url);
    const profileEmpty = shouldReturnEmpty(profile, search.query, best.directory_url);
    if (profileEmpty) return profileEmpty;
    if (profile.html !== null) {
      const contact = parseProfileContact(profile.html, best.directory_url);
      best.website = contact.website ?? best.website;
      best.email = contact.email ?? best.email;
      if (best.website && !best.signals.includes("directory_website")) {
        best.signals.push("directory_website");
      }
    }
  }

  return {
    ran_at: new Date().toISOString(),
    source: SOURCE,
    query: search.query,
    candidates,
    best_website:
      best && best.confidence >= config.min_confidence_to_use ? best.website : null,
  };
}
