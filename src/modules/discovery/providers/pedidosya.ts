import { load } from "cheerio";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "playwright";

chromium.use(StealthPlugin());
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";

const SOURCE: DiscoverySource = "pedidosya";
const SOURCE_CONFIDENCE = 0.7;
const BASE_URL = "https://www.pedidosya.com.uy";
const MAX_PAGES = 5;

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

const NICHE_CATEGORIES: Record<string, string | null> = {
  restaurant: "restaurantes",
  other: null,
};

interface PedidosYaListing {
  name: string;
  listingUrl: string;
  externalId: string;
}

interface PedidosYaDeps {
  fetchPage?: (url: string) => Promise<string>;
}

export function locationToSlug(location: string): string {
  // eslint-disable-next-line no-control-regex
  return location
    .replace(/\burugua?y\b/gi, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractName(ariaLabel: string | undefined): string | null {
  if (!ariaLabel) return null;
  const stripped = ariaLabel.replace("Ir al restaurante ", "").trim();
  // Defensive: if replace changed nothing (prefix absent), use full aria-label
  return stripped || ariaLabel.trim();
}

function extractExternalId(href: string): string {
  const uuidMatch = UUID_RE.exec(href);
  if (uuidMatch) return uuidMatch[1]!;
  // Fallback: slug is the last path segment minus the -menu suffix
  const lastSegment = href.split("/").pop() ?? href;
  return lastSegment.replace(/-menu$/, "");
}

function parsePage(html: string, citySlug: string): PedidosYaListing[] {
  const $ = load(html);
  const listings: PedidosYaListing[] = [];

  $(`a[href*="/${citySlug}/"][href$="-menu"]`).each((_i, el) => {
    const anchor = $(el);
    const href = anchor.attr("href");
    if (!href) return;

    const name = extractName(anchor.attr("aria-label"));
    if (!name) return;

    listings.push({
      name,
      listingUrl: `${BASE_URL}${href}`,
      externalId: extractExternalId(href),
    });
  });

  return listings;
}

export class PedidosYaProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;
  private readonly deps: PedidosYaDeps;

  constructor(deps: PedidosYaDeps = {}) {
    this.deps = deps;
  }

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const category = NICHE_CATEGORIES[query.niche];
    if (category == null) return [];

    const citySlug = locationToSlug(query.location);
    const candidates: DiscoveryCandidate[] = [];

    let browser: Browser | null = null;
    let fetchPage: (url: string) => Promise<string>;

    if (this.deps.fetchPage) {
      fetchPage = this.deps.fetchPage;
    } else {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "es-UY",
        timezoneId: "America/Montevideo",
      });
      fetchPage = async (url: string) => {
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle" });
          return await page.content();
        } finally {
          await page.close();
        }
      };
    }

    try {
      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url =
          pageNum === 1
            ? `${BASE_URL}/${category}/${citySlug}`
            : `${BASE_URL}/${category}/${citySlug}?page=${pageNum}`;

        let html: string;
        try {
          html = await fetchPage(url);
        } catch {
          break;
        }

        const listings = parsePage(html, citySlug);
        if (listings.length === 0) break;

        for (const listing of listings) {
          candidates.push({
            source: SOURCE,
            external_id: listing.externalId,
            source_confidence: SOURCE_CONFIDENCE,
            name: listing.name,
            address: null,
            phone: null,
            website: null,
            email: null,
            latitude: null,
            longitude: null,
            niche: query.niche,
            raw: {
              listing_url: listing.listingUrl,
              expedition_type: "delivery",
              category,
            },
          });
        }

        if (query.maxResults !== undefined && candidates.length >= query.maxResults) break;
      }
    } finally {
      await browser?.close();
    }

    return query.maxResults !== undefined ? candidates.slice(0, query.maxResults) : candidates;
  }
}
