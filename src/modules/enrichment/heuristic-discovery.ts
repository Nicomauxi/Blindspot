import { readFileSync } from "fs";
import { load as loadHtml } from "cheerio";
import pLimit from "p-limit";
import { load } from "js-yaml";
import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { getConfig } from "../../shared/config.js";
import type {
  HeuristicCandidate,
  HeuristicDiscovery,
  HeuristicDiscoveryMode,
  HeuristicSignal,
  HeuristicWhatsappCandidate,
  Lead,
} from "../../shared/types.js";
import { fetchHtml } from "./http.js";
import { detectLiveness, isHardDead } from "../social-enrich/liveness.js";

const HeuristicConfigSchema = z.object({
  heuristic_discovery: z.object({
    enabled: z.boolean(),
    outdated_year_threshold: z.number().int().default(2022),
    thresholds: z.object({
      website: z.number().min(0).max(1),
      website_single_word: z.number().min(0).max(1).default(0.35),
      social: z.number().min(0).max(1),
    }),
    tld_priority: z.array(z.string().min(1)),
    max_candidates_to_probe: z.number().int().positive(),
    max_social_variants: z.number().int().positive().default(1),
    city_suffixes: z.record(z.string(), z.string().min(1)).default({}),
    mobile_prefixes_uy: z.array(z.string().regex(/^\d+$/)),
    geographic_stop_words: z.array(z.string()).default([]),
    proper_noun_stop_words: z.array(z.string()).default([]),
  }),
});

export type HeuristicDiscoveryConfig = z.infer<
  typeof HeuristicConfigSchema
>["heuristic_discovery"];

interface HeuristicDeps {
  fetchHtml: typeof fetchHtml;
}

export interface HeuristicListsCtx {
  stopWords?: ReadonlySet<string>;
  nicheStopWords?: ReadonlySet<string>;
  descriptorWords?: ReadonlyMap<string, string>;
  blockedHeuristicDomains?: ReadonlySet<string>;
}

interface HeuristicDiscoveryOptions {
  additionalWebsiteUrls?: string[];
  extraStopWords?: ReadonlySet<string>;
  listsCtx?: HeuristicListsCtx;
  skipChannels?: {
    facebook?: boolean;
    instagram?: boolean;
    whatsapp?: boolean;
  };
}

const DEFAULT_DEPS: HeuristicDeps = { fetchHtml };
type WebsiteProbe = HeuristicCandidate & { html: string | null };
type WebsiteProbeInternal = WebsiteProbe & {
  schemaSocialRefs: Partial<Record<"facebook" | "instagram", string[]>>;
};

let cached: HeuristicDiscoveryConfig | null = null;

export function parseHeuristicConfig(yamlString: string): HeuristicDiscoveryConfig {
  const raw = load(yamlString);
  const result = HeuristicConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid enrichment config:\n${msgs}`);
  }
  return result.data.heuristic_discovery;
}

export function getHeuristicConfig(): HeuristicDiscoveryConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/enrichment.yaml", import.meta.url);
  cached = parseHeuristicConfig(readFileSync(yamlUrl, "utf-8"));
  return cached;
}

export function resetHeuristicConfigCache(): void {
  cached = null;
}

export function getHeuristicRefreshDays(): number {
  return getConfig().HEURISTIC_REFRESH_DAYS;
}

export function isHeuristicStale(
  discovery: Pick<HeuristicDiscovery, "ran_at"> | null | undefined,
  now = Date.now()
): boolean {
  if (!discovery?.ran_at) return true;
  const t = Date.parse(discovery.ran_at);
  if (Number.isNaN(t)) return true;
  return now - t >= getHeuristicRefreshDays() * 24 * 60 * 60 * 1_000;
}

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function tokenizeFromSlug(name: string): string[] {
  const slug = slugifyBusinessName(name);
  if (!slug) return [];
  return slug.split("-").filter(Boolean);
}

export function slugifyBusinessName(name: string): string {
  return asciiFold(name)
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function compactSlug(slug: string): string {
  return slug.replace(/-/g, "");
}

const DESCRIPTOR_WORDS = new Map<string, string>([
  ["peluqueria", "pelu"],
  ["peluquerias", "pelu"],
  ["barberia", "barber"],
  ["barberias", "barber"],
]);

export const STOP_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "the"]);

const NICHE_STOP_WORDS = new Set([
  "motors", "motor", "autos", "auto", "automovil", "automoviles",
  "vehiculo", "vehiculos", "propios", "concesionaria", "automotora",
  "automotores", "garage", "taller",
  "coiffeur", "estilista", "peluquero", "peluquera", "peinados",
  "peinado", "barbero", "cortes", "corte",
  "fitness", "sport", "sports", "training", "crossfit", "spinning",
  "cardio", "musculacion",
  "center", "centre", "centro", "studio", "estudio", "group", "grupo",
  "servicios", "service", "services", "soluciones", "solutions",
  // Geographic words removed — now loaded from config/enrichment.yaml: geographic_stop_words
]);

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function buildSlugVariants(name: string, ctx?: HeuristicListsCtx): string[] {
  const slug = slugifyBusinessName(name);
  if (!slug) return [];

  const words = slug.split("-").filter(Boolean);
  const stopWords = ctx?.stopWords ?? STOP_WORDS;
  const descriptorWords = ctx?.descriptorWords ?? DESCRIPTOR_WORDS;
  const meaningful = words.filter((word) => !stopWords.has(word));
  const variants: string[] = [];

  if (meaningful.length > 1) {
    const withoutTrailingDescriptor = meaningful.filter((word, index) => {
      const isLast = index === meaningful.length - 1;
      return !(isLast && descriptorWords.has(word));
    });
    if (withoutTrailingDescriptor.length > 0) variants.push(withoutTrailingDescriptor.join("-"));

    variants.push(
      meaningful.map((word) => descriptorWords.get(word) ?? word).join("-")
    );
  }

  variants.push(slug);
  variants.push(compactSlug(slug));

  return dedupe(variants).slice(0, 8);
}

function deriveCitySuffix(
  address: string | null,
  citySuffixes: Record<string, string>
): string | null {
  if (!address) return null;
  const foldedAddress = asciiFold(address).toLowerCase();
  for (const [city, suffix] of Object.entries(citySuffixes)) {
    if (foldedAddress.includes(asciiFold(city).toLowerCase())) return suffix;
  }
  return null;
}

function withCityVariants(variants: string[], citySuffix: string | null): string[] {
  if (!citySuffix) return variants;
  return dedupe(variants.flatMap((variant) => [variant, `${variant}-${citySuffix}`]));
}

function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] ?? null : null;
}

function extractApexDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = hostname.split(".");
    const ccTld = parts.at(-1);
    const secondLevel = parts.at(-2);
    const registrable = parts.at(-3);
    if (
      parts.length >= 3 &&
      ccTld?.length === 2 &&
      secondLevel !== undefined &&
      registrable !== undefined
    ) {
      if (["com", "net", "org", "edu", "gub", "mil"].includes(secondLevel)) {
        return `${registrable}.${ccTld}`;
      }
      return `${registrable}.${secondLevel}.${ccTld}`;
    }
    return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    return null;
  }
}

function hasRedirectMismatch(probedUrl: string, finalUrl: string | null): boolean {
  if (!finalUrl || finalUrl === probedUrl) return false;
  const probedApex = extractApexDomain(probedUrl);
  const finalApex = extractApexDomain(finalUrl);
  return probedApex !== null && finalApex !== null && probedApex !== finalApex;
}

function isPureComDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hostname.endsWith(".com") &&
      !hostname.endsWith(".com.uy") &&
      !hostname.endsWith(".com.ar") &&
      !hostname.endsWith(".com.br");
  } catch {
    return false;
  }
}

function htmlTextMatches(html: string, value: string): boolean {
  const folded = asciiFold(html).toLowerCase();
  return folded.includes(asciiFold(value).toLowerCase());
}

function phoneDigits(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function htmlDigitsMatch(html: string, digits: string): boolean {
  return html.replace(/\D/g, "").includes(digits);
}

type JsonObject = Record<string, unknown>;

interface LocalBusinessSchema {
  name?: string;
  telephone?: string;
  sameAs: string[];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalBusinessNode(node: JsonObject): boolean {
  return asArray(node["@type"]).some((value) => value === "LocalBusiness");
}

function collectJsonLdNodes(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdNodes);
  if (!isJsonObject(value)) return [];
  return [value, ...collectJsonLdNodes(value["@graph"])];
}

function parseLocalBusinessSchemas(html: string): LocalBusinessSchema[] {
  const $ = loadHtml(html);
  const schemas: LocalBusinessSchema[] = [];

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).contents().text();
    if (!raw.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      getLogger().warn({ err }, "Invalid JSON-LD script in heuristic discovery");
      return;
    }

    for (const node of collectJsonLdNodes(parsed)) {
      if (!isLocalBusinessNode(node)) continue;
      const sameAs = asArray(node["sameAs"]).filter(
        (value): value is string => typeof value === "string"
      );
      schemas.push({
        ...(typeof node["name"] === "string" ? { name: node["name"] } : {}),
        ...(typeof node["telephone"] === "string" ? { telephone: node["telephone"] } : {}),
        sameAs,
      });
    }
  });

  return schemas;
}

function schemaPhoneMatches(schemaPhone: string | undefined, leadPhone: string | null): boolean {
  const leadDigits = phoneDigits(leadPhone);
  if (!schemaPhone || !leadDigits) return false;
  const schemaDigits = schemaPhone.replace(/\D/g, "");
  return schemaDigits.includes(leadDigits) || leadDigits.includes(schemaDigits);
}

function classifySocialUrl(url: string): "facebook" | "instagram" | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("facebook.com")) return "facebook";
    if (host.includes("instagram.com")) return "instagram";
    return null;
  } catch {
    return null;
  }
}

export function buildSingleWordCandidates(
  name: string,
  tldPriority: string[],
  citySuffix: string | null,
  extraStopWords: ReadonlySet<string> = new Set(),
  ctx?: HeuristicListsCtx
): string[] {
  const words = tokenizeFromSlug(name);
  const stopWords = ctx?.stopWords ?? STOP_WORDS;
  const nicheStopWords = ctx?.nicheStopWords ?? NICHE_STOP_WORDS;
  const descriptorWords = ctx?.descriptorWords ?? DESCRIPTOR_WORDS;
  const qualifying = words.filter(
    (w) =>
      w.length >= 4 &&
      !stopWords.has(w) &&
      !nicheStopWords.has(w) &&
      !descriptorWords.has(w) &&
      !extraStopWords.has(w)
  );
  return qualifying.flatMap((word) => [
    ...tldPriority.map((tld) => `https://${word}.${tld}`),
    ...(citySuffix && tldPriority[0]
      ? [`https://${word}-${citySuffix}.${tldPriority[0]}`]
      : []),
  ]);
}

export function buildWebsiteCandidates(
  lead: Pick<Lead, "name"> & Partial<Pick<Lead, "address">>,
  tldPriority = getHeuristicConfig().tld_priority,
  citySuffixes = getHeuristicConfig().city_suffixes,
  extraStopWords: ReadonlySet<string> = new Set(),
  ctx?: HeuristicListsCtx
): string[] {
  const geoWords = getHeuristicConfig().geographic_stop_words;
  const effectiveStopWords: ReadonlySet<string> =
    geoWords.length > 0 ? new Set([...extraStopWords, ...geoWords]) : extraStopWords;
  const citySuffix = deriveCitySuffix(lead.address ?? null, citySuffixes);
  const singleWord = buildSingleWordCandidates(lead.name, tldPriority, citySuffix, effectiveStopWords, ctx);
  const fullName = withCityVariants(buildSlugVariants(lead.name, ctx), citySuffix).flatMap(
    (variant) => tldPriority.map((tld) => `https://${variant}.${tld}`)
  );
  return dedupe([...singleWord, ...fullName]).filter((url) => {
    const domain = extractApexDomain(url);
    return !domain || !ctx?.blockedHeuristicDomains?.has(domain);
  });
}

function buildSocialCandidateUrls(
  lead: Pick<Lead, "name"> & Partial<Pick<Lead, "address">>,
  kind: "facebook" | "instagram",
  config: HeuristicDiscoveryConfig,
  ctx?: HeuristicListsCtx
): string[] {
  const variants = withCityVariants(
    buildSlugVariants(lead.name, ctx),
    deriveCitySuffix(lead.address ?? null, config.city_suffixes)
  ).slice(0, config.max_social_variants);
  const base =
    kind === "facebook" ? "https://www.facebook.com" : "https://www.instagram.com";
  return variants.map((slug) => `${base}/${slug}`);
}

function normalizeUruguayMobile(
  phone: string | null,
  prefixes: string[]
): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("5980")) digits = `598${digits.slice(4)}`;
  if (digits.startsWith("0") && digits.length === 9) digits = `598${digits.slice(1)}`;
  if (digits.length === 8) digits = `598${digits}`;
  if (!digits.startsWith("598") || digits.length !== 11) return null;
  const local = digits.slice(3);
  const prefix = local.slice(0, 2);
  return prefixes.includes(prefix) ? `+${digits}` : null;
}

export function deriveWhatsappCandidate(
  lead: Pick<Lead, "phone">,
  prefixes = getHeuristicConfig().mobile_prefixes_uy
): HeuristicWhatsappCandidate | null {
  const number = normalizeUruguayMobile(lead.phone, prefixes);
  if (!number) return null;
  const digits = number.replace(/\D/g, "");
  return {
    kind: "whatsapp",
    number,
    url: `https://wa.me/${digits}`,
    score: 1,
    signals: ["uy-mobile-phone"],
  };
}

async function probeWebsiteCandidate(
  lead: Pick<Lead, "name" | "address" | "phone">,
  url: string,
  deps: HeuristicDeps
): Promise<WebsiteProbeInternal> {
  const fetched = await deps.fetchHtml(url);
  const signals: HeuristicSignal[] = [];
  let score = 0;
  const schemaSocialRefs: Partial<Record<"facebook" | "instagram", string[]>> = {};

  if (!fetched.error && fetched.html !== null && fetched.status !== null && fetched.status < 400) {
    signals.push("http-ok");
    score += 0.35;
  }

  const schemas = fetched.html ? parseLocalBusinessSchemas(fetched.html) : [];
  const schema = schemas[0] ?? null;
  if (schema) {
    if (schema.name && htmlTextMatches(schema.name, lead.name)) {
      signals.push("name_in_schema");
      score += 0.3;
    }
    if (schemaPhoneMatches(schema.telephone, lead.phone)) {
      signals.push("phone_in_schema");
      score += 0.35;
    }
    for (const sameAsUrl of schema.sameAs) {
      const kind = classifySocialUrl(sameAsUrl);
      if (!kind) continue;
      schemaSocialRefs[kind] = dedupe([...(schemaSocialRefs[kind] ?? []), sameAsUrl]);
    }
  } else if (fetched.html && htmlTextMatches(fetched.html, lead.name)) {
    signals.push("name-match");
    score += 0.35;
  }
  const city = cityFromAddress(lead.address);
  if (city && fetched.html && htmlTextMatches(fetched.html, city)) {
    signals.push("city-match");
    score += 0.2;
  }

  if (
    isPureComDomain(url) &&
    signals.includes("name-match") &&
    !signals.includes("city-match") &&
    !signals.includes("name_in_schema") &&
    !signals.includes("phone_in_schema")
  ) {
    score *= 0.5;
    signals.push("foreign-com-penalty");
  }

  if (hasRedirectMismatch(url, fetched.finalUrl)) {
    const filteredSignals = signals.filter(
      (signal) => signal !== "name-match" && signal !== "city-match"
    );
    filteredSignals.push("redirect-mismatch");
    signals.length = 0;
    signals.push(...filteredSignals);
    score *= 0.3;
  }

  return {
    kind: "website",
    url,
    score: Number(score.toFixed(2)),
    signals,
    status: "probed",
    http_status: fetched.status,
    final_url: fetched.finalUrl,
    html: fetched.html,
    schemaSocialRefs,
    ...(fetched.error ? { error: fetched.error } : {}),
  };
}

function socialHandleMatches(url: string, slug: string): boolean {
  try {
    const parsed = new URL(url);
    const handle = parsed.pathname
      .split("/")
      .filter(Boolean)[0]
      ?.replace(/^@/, "")
      .toLowerCase();
    return handle === slug;
  } catch {
    return false;
  }
}

function socialHandleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname
        .split("/")
        .filter(Boolean)[0]
        ?.replace(/^@/, "")
        .toLowerCase() ?? null
    );
  } catch {
    return null;
  }
}

function htmlLinksToUrl(html: string | null, url: string): boolean {
  if (!html) return false;
  const foldedHtml = html.toLowerCase();
  const normalizedUrl = url.toLowerCase().replace(/\/$/, "");
  const noWww = normalizedUrl.replace("://www.", "://");
  return (
    foldedHtml.includes(normalizedUrl) ||
    foldedHtml.includes(`${normalizedUrl}/`) ||
    foldedHtml.includes(noWww) ||
    foldedHtml.includes(`${noWww}/`)
  );
}

async function probeSocialCandidate(
  lead: Pick<Lead, "name" | "address" | "phone">,
  kind: "facebook" | "instagram",
  url: string,
  websiteHtml: string | null,
  schemaCrossRef: boolean,
  deps: HeuristicDeps
): Promise<HeuristicCandidate> {
  const slug = socialHandleFromUrl(url) ?? slugifyBusinessName(lead.name);
  const fetched = await deps.fetchHtml(url);
  const signals: HeuristicSignal[] = [];
  let score = 0;
  const fetchedOk =
    !fetched.error &&
    fetched.html !== null &&
    fetched.status !== null &&
    fetched.status < 400;

  if (fetchedOk && socialHandleMatches(url, slug)) {
    signals.push("slug_match");
    score += 0.2;
  }
  if (fetchedOk && fetched.html && htmlTextMatches(fetched.html, lead.name)) {
    signals.push("name_in_bio");
    score += 0.3;
  }
  const phone = phoneDigits(lead.phone);
  if (fetchedOk && phone && fetched.html && htmlDigitsMatch(fetched.html, phone)) {
    signals.push("phone_match");
    score += 0.25;
  }
  const city = cityFromAddress(lead.address);
  if (fetchedOk && city && fetched.html && htmlTextMatches(fetched.html, city)) {
    signals.push("city_match");
    score += 0.2;
  }
  if (schemaCrossRef || htmlLinksToUrl(websiteHtml, url)) {
    signals.push("cross_ref_from_web");
    score += schemaCrossRef ? 0.2 : 0.3;
  }

  // Liveness: descartar páginas muertas (borradas, redirigidas, título genérico). El og:title
  // suele quedar cacheado; sin este chequeo una página muerta sumaba score por puro ruido.
  const meta = extractLivenessMeta(fetched.html);
  const liveness = detectLiveness({
    platform: kind,
    requestedUrl: url,
    finalUrl: fetched.finalUrl,
    httpStatus: fetched.status,
    ogTitle: meta.ogTitle,
    ogDescription: meta.ogDescription,
    title: meta.title,
    h1: meta.h1,
    checkedAt: new Date().toISOString(),
  });

  // hard-dead anula el candidato (no debe asignarse ni confirmarse). soft-dead lo atenúa.
  if (isHardDead(liveness)) {
    score = 0;
    signals.length = 0;
  } else if (liveness.state === "dead") {
    score = Number((score * 0.4).toFixed(2));
  }

  return {
    kind,
    url,
    score: Number(score.toFixed(2)),
    signals,
    status: "probed",
    http_status: fetched.status,
    final_url: fetched.finalUrl,
    liveness,
    ...(fetched.error ? { error: fetched.error } : {}),
  };
}

// Extrae og:title / og:description / <title> / primer <h1> de un HTML crudo para liveness.
function extractLivenessMeta(html: string | null): {
  ogTitle: string | null;
  ogDescription: string | null;
  title: string | null;
  h1: string | null;
} {
  if (!html) return { ogTitle: null, ogDescription: null, title: null, h1: null };
  const metaContent = (prop: string): string | null => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
    const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? null;
  };
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
  return {
    ogTitle: metaContent("og:title"),
    ogDescription: metaContent("og:description"),
    title,
    h1,
  };
}

function bestByScore<T extends { score: number }>(items: T[], threshold: number): T | null {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const best = sorted[0] ?? null;
  return best && best.score >= threshold ? best : null;
}

function isSingleWordWebsiteUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const base = hostname.split(".")[0] ?? "";
    return base.length > 0 && !base.includes("-");
  } catch {
    return false;
  }
}

function isUruguayTld(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "uy" || hostname.endsWith(".uy");
  } catch {
    return false;
  }
}

function websiteThreshold(
  candidate: Pick<HeuristicCandidate, "url">,
  thresholds: HeuristicDiscoveryConfig["thresholds"]
): number {
  if (!isSingleWordWebsiteUrl(candidate.url)) return thresholds.website;
  return isUruguayTld(candidate.url) ? thresholds.website_single_word : thresholds.website;
}

function bestWebsiteByThreshold<T extends HeuristicCandidate>(
  items: T[],
  thresholds: HeuristicDiscoveryConfig["thresholds"]
): T | null {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  return sorted.find((item) => item.score >= websiteThreshold(item, thresholds)) ?? null;
}

export async function discoverHeuristicSources(
  lead: Lead,
  mode: HeuristicDiscoveryMode,
  deps: HeuristicDeps = DEFAULT_DEPS,
  options: HeuristicDiscoveryOptions = {}
): Promise<HeuristicDiscovery> {
  const config = getHeuristicConfig();
  const ranAt = new Date().toISOString();

  if (!config.enabled) {
    return {
      ran_at: ranAt,
      mode,
      stale: false,
      candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
      selected: { website: null, facebook: null, instagram: null, whatsapp: null },
    };
  }

  const websiteUrls = dedupe([
    ...(options.additionalWebsiteUrls ?? []),
    ...buildWebsiteCandidates(
      lead,
      config.tld_priority,
      config.city_suffixes,
      options.extraStopWords ?? new Set(),
      options.listsCtx
    ),
  ]).slice(0, config.max_candidates_to_probe);
  const probeLimit = pLimit(3);
  const websiteProbes = await Promise.all(
    websiteUrls.map((url) => probeLimit(() => probeWebsiteCandidate(lead, url, deps)))
  );
  const website = websiteProbes.map(
    ({ html: _html, schemaSocialRefs: _refs, ...candidate }) => candidate
  );
  const selectedWebsiteProbe = bestWebsiteByThreshold(websiteProbes, config.thresholds);
  const selectedWebsiteHtml = selectedWebsiteProbe ? selectedWebsiteProbe.html : null;
  const selectedSchemaRefs = selectedWebsiteProbe ? selectedWebsiteProbe.schemaSocialRefs : {};

  const schemaFacebookRefs = selectedSchemaRefs.facebook ?? [];
  const schemaInstagramRefs = selectedSchemaRefs.instagram ?? [];
  if (options.skipChannels?.facebook) {
    getLogger().debug({ leadId: lead.id, channel: "facebook", reason: "confirmed" }, "skipping heuristic channel");
  }
  if (options.skipChannels?.instagram) {
    getLogger().debug({ leadId: lead.id, channel: "instagram", reason: "confirmed" }, "skipping heuristic channel");
  }
  const facebookUrls =
    (!options.skipChannels?.facebook && mode === "full")
      ? dedupe([...buildSocialCandidateUrls(lead, "facebook", config, options.listsCtx), ...schemaFacebookRefs])
      : [];
  const instagramUrls =
    (!options.skipChannels?.instagram && mode === "full")
      ? dedupe([...buildSocialCandidateUrls(lead, "instagram", config, options.listsCtx), ...schemaInstagramRefs])
      : [];
  const facebook = await Promise.all(
    facebookUrls.map((url) =>
      probeSocialCandidate(
        lead,
        "facebook",
        url,
        selectedWebsiteHtml,
        schemaFacebookRefs.includes(url),
        deps
      )
    )
  );
  const instagram = await Promise.all(
    instagramUrls.map((url) =>
      probeSocialCandidate(
        lead,
        "instagram",
        url,
        selectedWebsiteHtml,
        schemaInstagramRefs.includes(url),
        deps
      )
    )
  );
  if (options.skipChannels?.whatsapp) {
    getLogger().debug({ leadId: lead.id, channel: "whatsapp", reason: "confirmed" }, "skipping heuristic channel");
  }
  const whatsappCandidate =
    (!options.skipChannels?.whatsapp && mode === "full")
      ? deriveWhatsappCandidate(lead, config.mobile_prefixes_uy)
      : null;
  const whatsapp = whatsappCandidate ? [whatsappCandidate] : [];

  return {
    ran_at: ranAt,
    mode,
    stale: false,
    candidates: { website, facebook, instagram, whatsapp },
    selected: {
      website: bestWebsiteByThreshold(website, config.thresholds),
      facebook: bestByScore(facebook, config.thresholds.social),
      instagram: bestByScore(instagram, config.thresholds.social),
      whatsapp: bestByScore(whatsapp, config.thresholds.social),
    },
  };
}
