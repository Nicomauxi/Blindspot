import { getLogger } from "../../shared/logger.js";
import { isSocialOrMissingWeb } from "../discovery/filters.js";
import { getDiscoveryConfig } from "../discovery/config.js";
import type {
  DigitalFootprint,
  DigitalFootprintEnriched,
  DirectoryDiscovery,
  HeuristicDiscovery,
  HeuristicDiscoveryMode,
  Lead,
  SocialSearch,
} from "../../shared/types.js";
import { fetchHtml } from "./http.js";
import {
  discoverDirectorySources,
  isDirectoryStale,
} from "./directory-discovery.js";
import {
  discoverHeuristicSources,
  isHeuristicStale,
} from "./heuristic-discovery.js";
import {
  discoverSocialSearch,
  isSocialSearchStale,
  isUruguayMobilePhone,
} from "./social-search.js";
import { parsePixels } from "./parsers/pixels.js";
import { parseStack } from "./parsers/stack.js";
import { parseViewport } from "./parsers/viewport.js";
import { parseWhatsapp } from "./parsers/whatsapp.js";
import { parseSocialLinks } from "./parsers/social-links.js";
import { parseOperationalSystems } from "./parsers/operational-systems.js";
import { OUTDATED_YEAR_THRESHOLD, parseCopyrightYear } from "./parsers/copyright-year.js";
import { parseSsl } from "./parsers/ssl.js";
import { whoisLookup, normalizeDomain } from "./whois.js";

const HTML_CACHE_MS = 7 * 24 * 60 * 60 * 1_000;
const WHOIS_CACHE_MS = 30 * 24 * 60 * 60 * 1_000;
const PHONE_MOBILE_HEURISTIC = /^\+?\d{10,}$/;
const SOCIAL_SEARCH_THRESHOLD = 0.4;

export interface EnrichLeadOptions {
  forceRefresh: boolean;
  withHeuristic?: boolean;
  extraStopWords?: ReadonlySet<string>;
}

export type EnrichOutcome =
  | "skipped-no-website"
  | "skipped-social"
  | "cache-hit"
  | "fetched-ok"
  | "fetched-error";

export interface EnrichLeadResult {
  digital_footprint: DigitalFootprint;
  tags_to_add: string[];
  whatsapp_from_site: string | null;
  outcome: EnrichOutcome;
  duration_ms: number;
}

interface EnrichmentDeps {
  fetchHtml: typeof fetchHtml;
  whoisLookup: typeof whoisLookup;
  heuristicDiscover: typeof discoverHeuristicSources;
  directoryDiscover: typeof discoverDirectorySources;
  socialSearchDiscover: typeof discoverSocialSearch;
}

const DEFAULT_DEPS: EnrichmentDeps = {
  fetchHtml,
  whoisLookup,
  heuristicDiscover: discoverHeuristicSources,
  directoryDiscover: discoverDirectorySources,
  socialSearchDiscover: discoverSocialSearch,
};

function parseIso(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function asEnriched(
  footprint: DigitalFootprint | null
): DigitalFootprintEnriched | null {
  if (!footprint) return null;
  if (footprint.skipped === true) return null;
  return footprint;
}

function getHeuristic(footprint: DigitalFootprint | null): HeuristicDiscovery | null {
  return footprint?.heuristic_discovery ?? null;
}

function getDirectory(footprint: DigitalFootprint | null): DirectoryDiscovery | null {
  return footprint?.directory_discovery ?? null;
}

function getSocialSearch(footprint: DigitalFootprint | null): SocialSearch | null {
  return footprint?.social_search ?? null;
}

function isHtmlCacheFresh(footprint: DigitalFootprint | null): boolean {
  const enriched = asEnriched(footprint);
  if (!enriched) return false;
  // If the previous attempt errored, we don't honor cache — we want to retry.
  if (enriched.fetch_error) return false;
  const t = parseIso(enriched.fetched_at);
  if (t === null) return false;
  return Date.now() - t < HTML_CACHE_MS;
}

function isWhoisCacheFresh(footprint: DigitalFootprint | null): boolean {
  const enriched = asEnriched(footprint);
  if (!enriched || !enriched.whois) return false;
  const t = parseIso(enriched.whois.fetched_at);
  if (t === null) return false;
  return Date.now() - t < WHOIS_CACHE_MS;
}

function deriveTags(
  footprint: DigitalFootprintEnriched,
  lead: Pick<Lead, "phone">
): string[] {
  const tags: string[] = [];

  if (footprint.fetch_error) {
    tags.push("site-unreachable");
  }

  if (footprint.pixels) {
    if (!footprint.pixels.meta_pixel.present) tags.push("pixel-missing");
    const anyAnalytics =
      footprint.pixels.ga4.present ||
      footprint.pixels.ga_universal.present ||
      footprint.pixels.gtm.present;
    if (!anyAnalytics) tags.push("analytics-missing");
  }

  if (footprint.viewport && !footprint.viewport.present) {
    tags.push("not-responsive");
  }

  if (footprint.whatsapp && !footprint.whatsapp.present) {
    const leadHasMobile = !!lead.phone && PHONE_MOBILE_HEURISTIC.test(lead.phone.replace(/\s/g, ""));
    if (!leadHasMobile) tags.push("whatsapp-missing");
  }

  if (footprint.ssl && !footprint.ssl.valid_https) {
    tags.push("ssl-missing");
  }

  if (
    footprint.copyright_year !== undefined &&
    footprint.copyright_year !== null &&
    footprint.copyright_year <= OUTDATED_YEAR_THRESHOLD
  ) {
    tags.push("web-outdated");
  }

  if (footprint.stack && footprint.stack.confidence !== "low") {
    if (footprint.stack.name === "WordPress" && footprint.stack.version) {
      const major = parseInt(footprint.stack.version.split(".")[0] ?? "", 10);
      if (!Number.isNaN(major) && major < 5) tags.push("stack-obsolete");
    }
    // TODO: detect Wix legacy / Joomla / Drupal obsolete versions when feasible.
  }

  if (
    footprint.whois &&
    footprint.whois.age_years !== null &&
    footprint.whois.age_years > 5
  ) {
    // Note: original spec mentions "domain > 5 years without renewed look".
    // The "renewed look" part is not detectable from WHOIS alone; we tag by
    // age only.
    tags.push("domain-old-stale");
  }

  return tags;
}

function pixelsSummary(p: DigitalFootprintEnriched["pixels"]): string {
  if (!p) return "n/a";
  const parts: string[] = [];
  if (p.meta_pixel.present) parts.push("meta");
  if (p.ga4.present) parts.push("ga4");
  if (p.ga_universal.present) parts.push("ga-universal");
  if (p.gtm.present) parts.push("gtm");
  return parts.length > 0 ? parts.join("+") : "none";
}

function heuristicTags(discovery: HeuristicDiscovery | null): string[] {
  const tags: string[] = [];
  if (!discovery) return tags;
  if (discovery.selected.website) tags.push("website-heuristic");
  if (discovery.selected.facebook) tags.push("fb-heuristic");
  if (discovery.selected.instagram) tags.push("ig-heuristic");
  if (discovery.selected.whatsapp) tags.push("whatsapp-derived");
  if (discovery.stale) tags.push("heuristic-stale");
  return tags;
}

function socialSearchTags(search: SocialSearch | null): string[] {
  const tags: string[] = [];
  if (!search) return tags;
  if (search.source === "duckduckgo") {
    if (search.facebook.best_url && search.facebook.confidence >= SOCIAL_SEARCH_THRESHOLD) {
      tags.push("fb-confirmed");
    }
    if (search.instagram.best_url && search.instagram.confidence >= SOCIAL_SEARCH_THRESHOLD) {
      tags.push("ig-confirmed");
    }
    if (
      search.facebook.additional_phones.length > 0 ||
      search.instagram.additional_phones.length > 0
    ) {
      tags.push("additional-phones");
    }
    return tags;
  }
  if (search.facebook && search.facebook.confidence >= 0.7) {
    tags.push("fb-confirmed");
    if (search.facebook.whatsapp_button) tags.push("whatsapp-confirmed");
  }
  if (search.instagram && search.instagram.confidence >= 0.7) {
    tags.push("ig-confirmed");
  }
  return tags;
}

function socialSearchAdditionalPhones(search: SocialSearch | null): string[] {
  if (!search) return [];
  if (search.source === "duckduckgo") {
    return Array.from(new Set([
      ...search.facebook.additional_phones,
      ...search.instagram.additional_phones,
    ]));
  }
  return search.facebook?.phone ? [search.facebook.phone] : [];
}

function shouldRunSocialSearch(
  lead: Lead,
  opts: EnrichLeadOptions,
  heuristicDiscovery: HeuristicDiscovery | null
): boolean {
  if (opts.withHeuristic === true) return true;
  const tags = new Set([...lead.tags, ...heuristicTags(heuristicDiscovery)]);
  if (tags.has("fb-heuristic") || tags.has("ig-heuristic")) return true;
  return tags.has("no-website") && !tags.has("whatsapp-derived") && !lead.whatsapp;
}

async function resolveHeuristic(
  lead: Lead,
  mode: HeuristicDiscoveryMode,
  opts: EnrichLeadOptions,
  deps: EnrichmentDeps,
  additionalWebsiteUrls: string[] = []
): Promise<HeuristicDiscovery> {
  const previous = getHeuristic(lead.digital_footprint);
  const wasStale = isHeuristicStale(previous);

  if (
    previous &&
    previous.mode === mode &&
    !wasStale &&
    !opts.forceRefresh &&
    additionalWebsiteUrls.length === 0
  ) {
    return previous;
  }

  return deps.heuristicDiscover(
    lead,
    mode,
    { fetchHtml: deps.fetchHtml },
    {
      additionalWebsiteUrls,
      ...(opts.extraStopWords !== undefined ? { extraStopWords: opts.extraStopWords } : {}),
    }
  );
}

async function resolveDirectory(
  lead: Lead,
  opts: EnrichLeadOptions,
  deps: EnrichmentDeps
): Promise<DirectoryDiscovery> {
  const previous = getDirectory(lead.digital_footprint);
  if (previous && !isDirectoryStale(previous) && !opts.forceRefresh) {
    return previous;
  }

  return deps.directoryDiscover(lead, { fetchHtml: deps.fetchHtml });
}

async function resolveSocialSearch(
  lead: Lead,
  opts: EnrichLeadOptions,
  deps: EnrichmentDeps,
  heuristicDiscovery: HeuristicDiscovery | null
): Promise<SocialSearch | null> {
  if (!shouldRunSocialSearch(lead, opts, heuristicDiscovery)) return getSocialSearch(lead.digital_footprint);

  const previous = getSocialSearch(lead.digital_footprint);
  if (
    previous &&
    !isSocialSearchStale(previous) &&
    !opts.forceRefresh &&
    opts.withHeuristic !== true
  ) {
    return previous;
  }

  return deps.socialSearchDiscover(lead);
}

export async function enrichLead(
  lead: Lead,
  opts: EnrichLeadOptions,
  depsOverrides: Partial<EnrichmentDeps> = {}
): Promise<EnrichLeadResult> {
  const deps: EnrichmentDeps = { ...DEFAULT_DEPS, ...depsOverrides };
  const log = getLogger();
  const start = Date.now();
  const fetchedAtIso = new Date().toISOString();
  const originalWebsite = lead.website?.trim() ?? "";
  const isSocialWebsite =
    !!originalWebsite &&
    isSocialOrMissingWeb(originalWebsite, getDiscoveryConfig().social_domains);
  let effectiveWebsite = originalWebsite;
  let directoryDiscovery: DirectoryDiscovery | null = null;
  let heuristicDiscovery: HeuristicDiscovery | null = null;
  let socialSearch: SocialSearch | null = null;

  const cachedHeuristic = getHeuristic(lead.digital_footprint);
  if (
    cachedHeuristic?.selected.website &&
    cachedHeuristic.stale !== true &&
    !isHeuristicStale(cachedHeuristic)
  ) {
    heuristicDiscovery = cachedHeuristic;
    effectiveWebsite = cachedHeuristic.selected.website.url;
  }

  // 1. Resolve directory + heuristic sources before the normal enrichment flow.
  if ((!originalWebsite || isSocialWebsite) && opts.withHeuristic === true) {
    directoryDiscovery = await resolveDirectory(lead, opts, deps);
    const directoryWebsiteUrls = directoryDiscovery.best_website
      ? [directoryDiscovery.best_website]
      : [];
    const mode: HeuristicDiscoveryMode = isSocialWebsite ? "website-only" : "full";
    heuristicDiscovery = await resolveHeuristic(lead, mode, opts, deps, directoryWebsiteUrls);
    if (heuristicDiscovery.selected.website) {
      effectiveWebsite = heuristicDiscovery.selected.website.url;
    }
  }

  socialSearch = await resolveSocialSearch(lead, opts, deps, heuristicDiscovery);

  // 2. No website after optional heuristic.
  if (!effectiveWebsite) {
    const tags = [
      ...heuristicTags(heuristicDiscovery),
      ...socialSearchTags(socialSearch),
    ];
    const socialMobile = socialSearchAdditionalPhones(socialSearch).find(isUruguayMobilePhone) ?? null;
    if (socialMobile && (lead.tags.includes("whatsapp-missing") || opts.withHeuristic === true)) {
      tags.push("whatsapp-derived");
    }
    return {
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: fetchedAtIso,
        ...(heuristicDiscovery ? { heuristic_discovery: heuristicDiscovery } : {}),
        ...(directoryDiscovery ? { directory_discovery: directoryDiscovery } : {}),
        ...(socialSearch ? { social_search: socialSearch } : {}),
      },
      tags_to_add: tags,
      whatsapp_from_site: heuristicDiscovery?.selected.whatsapp?.number ?? socialMobile,
      outcome: "skipped-no-website",
      duration_ms: Date.now() - start,
    };
  }

  // 3. Social-only after optional heuristic.
  if (isSocialWebsite && effectiveWebsite === originalWebsite) {
    return {
      digital_footprint: {
        skipped: true,
        reason: "social-only",
        fetched_at: fetchedAtIso,
        ...(heuristicDiscovery ? { heuristic_discovery: heuristicDiscovery } : {}),
        ...(directoryDiscovery ? { directory_discovery: directoryDiscovery } : {}),
        ...(socialSearch ? { social_search: socialSearch } : {}),
      },
      tags_to_add: [
        ...heuristicTags(heuristicDiscovery),
        ...socialSearchTags(socialSearch),
      ],
      whatsapp_from_site: null,
      outcome: "skipped-social",
      duration_ms: Date.now() - start,
    };
  }

  // 4. Normal flow.
  const cachedHtml = !opts.forceRefresh && isHtmlCacheFresh(lead.digital_footprint);
  const cachedWhois = !opts.forceRefresh && isWhoisCacheFresh(lead.digital_footprint);
  const previous = asEnriched(lead.digital_footprint);

  let footprint: DigitalFootprintEnriched;

  if (cachedHtml && previous) {
    footprint = {
      ...previous,
      ...(heuristicDiscovery ? { heuristic_discovery: heuristicDiscovery } : {}),
      ...(directoryDiscovery ? { directory_discovery: directoryDiscovery } : {}),
      ...(socialSearch ? { social_search: socialSearch } : {}),
    };
  } else {
    const fetched = await deps.fetchHtml(effectiveWebsite);
    if (fetched.error || fetched.html === null) {
      footprint = {
        fetched_at: fetched.fetchedAt,
        fetch_error: fetched.error ?? "unknown-fetch-error",
        attempted_url: effectiveWebsite,
        ...(fetched.finalUrl !== null ? { final_url: fetched.finalUrl } : {}),
        ...(fetched.status !== null ? { http_status: fetched.status } : {}),
        ...(heuristicDiscovery ? { heuristic_discovery: heuristicDiscovery } : {}),
        ...(directoryDiscovery ? { directory_discovery: directoryDiscovery } : {}),
        ...(socialSearch ? { social_search: socialSearch } : {}),
      };
    } else {
      const html = fetched.html;
      const headers = fetched.headers;
      const finalUrl = fetched.finalUrl;
      const [pixels, stack, viewport, whatsapp, social_links, operational_systems, copyright_year] = await Promise.all([
        Promise.resolve(parsePixels(html)),
        Promise.resolve(parseStack(html, headers)),
        Promise.resolve(parseViewport(html)),
        Promise.resolve(parseWhatsapp(html)),
        Promise.resolve(parseSocialLinks(html)),
        Promise.resolve(parseOperationalSystems(html)),
        Promise.resolve(parseCopyrightYear(html)),
      ]);
      const ssl = parseSsl(finalUrl);

      footprint = {
        fetched_at: fetched.fetchedAt,
        attempted_url: effectiveWebsite,
        ...(finalUrl !== null ? { final_url: finalUrl } : {}),
        ...(fetched.status !== null ? { http_status: fetched.status } : {}),
        ssl,
        pixels,
        stack,
        viewport,
        whatsapp,
        social_links,
        operational_systems,
        ...(copyright_year.year !== null ? { copyright_year: copyright_year.year } : {}),
        ...(heuristicDiscovery ? { heuristic_discovery: heuristicDiscovery } : {}),
        ...(directoryDiscovery ? { directory_discovery: directoryDiscovery } : {}),
        ...(socialSearch ? { social_search: socialSearch } : {}),
      };
    }
  }

  // WHOIS — independent cache, may refresh even if HTML cached.
  if (cachedWhois && previous && previous.whois) {
    footprint.whois = previous.whois;
  } else {
    try {
      const domain = normalizeDomain(effectiveWebsite);
      const w = await deps.whoisLookup(domain);
      footprint.whois = w;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ leadId: lead.id, err: msg }, "whois unexpected failure");
      footprint.whois = {
        fetched_at: new Date().toISOString(),
        created_at: null,
        registrar: null,
        expires_at: null,
        age_years: null,
        error: msg,
      };
    }
  }

  const tags_to_add = [
    ...deriveTags(footprint, lead),
    ...heuristicTags(heuristicDiscovery),
    ...socialSearchTags(socialSearch),
  ];
  const socialMobile = socialSearchAdditionalPhones(socialSearch).find(isUruguayMobilePhone) ?? null;
  if (socialMobile && tags_to_add.includes("whatsapp-missing")) {
    tags_to_add.push("whatsapp-derived");
  }
  const whatsapp_from_site =
    footprint.whatsapp && footprint.whatsapp.numbers.length > 0
      ? footprint.whatsapp.numbers[0] ?? null
      : socialMobile;

  const outcome: EnrichOutcome = cachedHtml
    ? "cache-hit"
    : footprint.fetch_error
      ? "fetched-error"
      : "fetched-ok";

  const duration_ms = Date.now() - start;

  log.info(
    {
      leadId: lead.id,
      name: lead.name,
      website: effectiveWebsite,
      sourceWebsite: originalWebsite || null,
      heuristicMode: heuristicDiscovery?.mode ?? null,
      outcome,
      signals: {
        pixels: pixelsSummary(footprint.pixels),
        stack: footprint.stack
          ? `${footprint.stack.name}${footprint.stack.version ? " " + footprint.stack.version : ""}`
          : "unknown",
        ssl: footprint.ssl?.valid_https ?? null,
        whois_age: footprint.whois?.age_years ?? null,
      },
      tags_added: tags_to_add,
      duration_ms,
    },
    "lead enriched"
  );

  return {
    digital_footprint: footprint,
    tags_to_add,
    whatsapp_from_site,
    outcome,
    duration_ms,
  };
}
