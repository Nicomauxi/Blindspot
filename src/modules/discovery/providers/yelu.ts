import { load } from "cheerio";
import { fetch as undiciFetch } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";
import { getScrapingConfig } from "../config.js";
import { backoffMs, isBlockedStatus, pickRandom, randomBetween } from "../../../shared/scraping.js";

const SOURCE: DiscoverySource = "yelu";
const SOURCE_CONFIDENCE = 0.65;
const BASE_URL = "https://www.yelu.uy";
const MAX_PAGES = 20;

const NICHE_CATEGORIES: Record<string, string | null> = {
  restaurant: "Restaurantes",
  gym: "Gimnasios",
  hairdresser: "Peluqueros",
  car_dealer: "Concesionarios_de_Autos",
  accommodation: "Hoteles",
  pharmacy: "Farmacias",
  grocery: "Supermercados",
  dentist: "Dentistas",
  healthcare: "Medicos",
  other: null,
};

interface YeluListing {
  cmpid: string;
  name: string | null;
  address: string | null;
  phone: string | null;
}

interface YeluDeps {
  fetch: (url: string, ua: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  sleepFn: (ms: number) => Promise<void>;
}

export function locationToSlug(location: string): string {
  // eslint-disable-next-line no-control-regex
  return location
    .replace(/\burugua?y\b/gi, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePage(html: string): YeluListing[] {
  const $ = load(html);
  const listings: YeluListing[] = [];

  $("div.company[data-cmpid]").each((_i, el) => {
    const company = $(el);
    const cmpid = company.attr("data-cmpid");
    if (!cmpid) return;

    const name = company.find("h3 > a").first().text().trim() || null;
    const address = company.find("div.address").first().text().trim() || null;

    let phone: string | null = null;
    company.find("div.s").each((_j, section) => {
      const sec = $(section);
      if (sec.find("i.fa-phone").length > 0) {
        const candidate = sec.find("span").first().text().trim();
        if (candidate) phone = candidate;
        return false; // break
      }
    });

    listings.push({ cmpid, name, address, phone });
  });

  return listings;
}

const noopSleep = (): Promise<void> => Promise.resolve();

function defaultFetch(url: string, ua: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return undiciFetch(url, { headers: { "User-Agent": ua } }) as ReturnType<typeof defaultFetch>;
}

export class YeluProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;
  private readonly deps: YeluDeps;

  constructor(deps: Partial<YeluDeps> = {}) {
    this.deps = {
      fetch: defaultFetch,
      sleepFn: noopSleep,
      ...deps,
    };
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const category = NICHE_CATEGORIES[query.niche];
    if (category == null) return [];

    const citySlug = locationToSlug(query.location);
    const candidates: DiscoveryCandidate[] = [];
    const scrapingCfg = getScrapingConfig();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        page === 1
          ? `${BASE_URL}/category/${category}/city:${citySlug}`
          : `${BASE_URL}/category/${category}/${page}/city:${citySlug}`;

      if (page > 1) {
        const delayMs = randomBetween(scrapingCfg.discovery_delay_ms[0], scrapingCfg.discovery_delay_ms[1]);
        await this.deps.sleepFn(delayMs);
      }

      let html: string | null = null;
      for (let attempt = 0; attempt <= scrapingCfg.discovery_max_retries; attempt++) {
        const ua = pickRandom(scrapingCfg.discovery_ua_pool);
        let res: { ok: boolean; status: number; text: () => Promise<string> };
        try {
          res = await this.deps.fetch(url, ua);
        } catch {
          if (attempt < scrapingCfg.discovery_max_retries) {
            await this.deps.sleepFn(backoffMs(attempt));
            continue;
          }
          break;
        }

        if (isBlockedStatus(res.status)) {
          if (attempt < scrapingCfg.discovery_max_retries) {
            await this.deps.sleepFn(backoffMs(attempt, 2000));
            continue;
          }
          break;
        }

        if (!res.ok) break;

        html = await res.text();
        break;
      }

      if (html === null) break;

      const listings = parsePage(html);
      if (listings.length === 0) break;

      for (const listing of listings) {
        candidates.push({
          source: SOURCE,
          external_id: listing.cmpid,
          source_confidence: SOURCE_CONFIDENCE,
          name: listing.name ?? "",
          address: listing.address,
          phone: listing.phone,
          website: null,
          email: null,
          latitude: null,
          longitude: null,
          niche: query.niche,
          raw: {
            cmpid: listing.cmpid,
            directory_url: `${BASE_URL}/company/${listing.cmpid}/`,
          },
        });
      }

      if (query.maxResults !== undefined && candidates.length >= query.maxResults) break;
    }

    return query.maxResults !== undefined ? candidates.slice(0, query.maxResults) : candidates;
  }
}
