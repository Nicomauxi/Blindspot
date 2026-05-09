import { describe, expect, it } from "vitest";
import {
  buildWebsiteCandidates,
  deriveWhatsappCandidate,
  discoverHeuristicSources,
  isHeuristicStale,
  parseHeuristicConfig,
  slugifyBusinessName,
} from "../../src/modules/enrichment/heuristic-discovery.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: null,
    name: "Peluquería Ñandú",
    address: "18 de Julio 1234, Montevideo",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: "099 123 456",
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    prospect_score: null,
    score_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("heuristic discovery", () => {
  it("parses approved enrichment config shape", () => {
    const config = parseHeuristicConfig(`
heuristic_discovery:
  enabled: true
  thresholds: { website: 0.7, social: 0.6 }
  tld_priority: [com.uy, uy, com]
  max_candidates_to_probe: 6
  mobile_prefixes_uy: ["91", "99"]
`);
    expect(config.enabled).toBe(true);
    expect(config.thresholds.website).toBe(0.7);
    expect(config.tld_priority).toEqual(["com.uy", "uy", "com"]);
    expect(config.max_social_variants).toBe(1);
    expect(config.city_suffixes).toEqual({});
  });

  it("builds slug and website candidates by TLD priority", () => {
    expect(slugifyBusinessName("Peluquería Ñandú")).toBe("peluqueria-nandu");
    expect(buildWebsiteCandidates(makeLead(), ["com.uy", "uy"], {})).toEqual([
      "https://peluqueria-nandu.com.uy",
      "https://peluqueria-nandu.uy",
      "https://pelu-nandu.com.uy",
      "https://pelu-nandu.uy",
      "https://peluquerianandu.com.uy",
      "https://peluquerianandu.uy",
    ]);
  });

  it("builds smart website slug variants with city suffixes, dedupe, and fallback", () => {
    const urls = buildWebsiteCandidates(
      makeLead({
        name: "Violet Peluquería",
        address: "Av. Italia 1234, Montevideo, Uruguay",
      }),
      ["com.uy"],
      { montevideo: "mvd" }
    );

    expect(urls).toEqual([
      "https://violet.com.uy",
      "https://violet-mvd.com.uy",
      "https://violet-pelu.com.uy",
      "https://violet-pelu-mvd.com.uy",
      "https://violet-peluqueria.com.uy",
      "https://violet-peluqueria-mvd.com.uy",
      "https://violetpeluqueria.com.uy",
      "https://violetpeluqueria-mvd.com.uy",
    ]);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("scores website signals and selects candidates over threshold", async () => {
    const result = await discoverHeuristicSources(makeLead(), "full", {
      fetchHtml: async (url) => ({
        status: 200,
        finalUrl: url,
        html: "<html><title>Peluquería Ñandú Montevideo</title></html>",
        headers: {},
        fetchedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    expect(result.selected.website?.url).toBe("https://peluqueria-nandu.com.uy");
    expect(result.selected.website?.signals).toEqual([
      "http-ok",
      "name-match",
      "city-match",
    ]);
    expect(result.selected.facebook?.url).toBe("https://www.facebook.com/peluqueria-nandu");
    expect(result.selected.facebook?.signals).toEqual([
      "slug_match",
      "name_in_bio",
      "city_match",
    ]);
    expect(result.selected.instagram?.url).toBe("https://www.instagram.com/peluqueria-nandu");
  });

  it("limits website probes and selects the highest-scoring social variant", async () => {
    const probedUrls: string[] = [];
    const result = await discoverHeuristicSources(
      makeLead({
        name: "Violet Peluquería",
        address: "Av. Italia 1234, Montevideo, Uruguay",
      }),
      "full",
      {
        fetchHtml: async (url) => {
          probedUrls.push(url);
          if (url.includes("facebook.com/violet-pelu")) {
            return {
              status: 200,
              finalUrl: url,
              html: "Violet Peluquería Montevideo 099 123 456",
              headers: {},
              fetchedAt: "2026-01-01T00:00:00.000Z",
            };
          }
          return {
            status: 200,
            finalUrl: url,
            html: url.includes("instagram.com") ? "Violet Peluquería Montevideo" : "Violet Peluquería Montevideo",
            headers: {},
            fetchedAt: "2026-01-01T00:00:00.000Z",
          };
        },
      }
    );

    expect(probedUrls.filter((url) => !url.includes("facebook.com") && !url.includes("instagram.com"))).toHaveLength(6);
    expect(result.candidates.facebook).toHaveLength(3);
    expect(result.candidates.instagram).toHaveLength(3);
    expect(result.selected.facebook?.url).toBe("https://www.facebook.com/violet-pelu");
  });

  it("uses LocalBusiness JSON-LD schema signals over HTML name matching", async () => {
    const result = await discoverHeuristicSources(
      makeLead({
        name: "Violet Peluquería",
        phone: "+598 99 123 456",
      }),
      "website-only",
      {
        fetchHtml: async (url) => ({
          status: 200,
          finalUrl: url,
          html: `<script type="application/ld+json">${JSON.stringify({
            "@type": "LocalBusiness",
            name: "Violet Peluquería",
            telephone: "+59899123456",
          })}</script>`,
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      }
    );

    expect(result.selected.website?.signals).toEqual([
      "http-ok",
      "name_in_schema",
      "phone_in_schema",
    ]);
    expect(result.selected.website?.signals).not.toContain("name-match");
  });

  it("falls back to HTML signals when JSON-LD is invalid", async () => {
    const result = await discoverHeuristicSources(makeLead(), "website-only", {
      fetchHtml: async (url) => ({
        status: 200,
        finalUrl: url,
        html: `<script type="application/ld+json">{bad json</script><title>Peluquería Ñandú Montevideo</title>`,
        headers: {},
        fetchedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    expect(result.selected.website?.signals).toEqual([
      "http-ok",
      "name-match",
      "city-match",
    ]);
  });

  it("adds schema sameAs social refs with cross-ref signal", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "Violet Peluquería", address: "Montevideo, Uruguay" }),
      "full",
      {
        fetchHtml: async (url) => {
          if (url.includes("instagram.com/violetpelu")) {
            return {
              status: 200,
              finalUrl: url,
              html: "Violet Peluquería Montevideo",
              headers: {},
              fetchedAt: "2026-01-01T00:00:00.000Z",
            };
          }

          return {
            status: 200,
            finalUrl: url,
            html: `<script type="application/ld+json">${JSON.stringify({
              "@type": "LocalBusiness",
              name: "Violet Peluquería",
              telephone: "099 123 456",
              sameAs: ["https://www.instagram.com/violetpelu"],
            })}</script>`,
            headers: {},
            fetchedAt: "2026-01-01T00:00:00.000Z",
          };
        },
      }
    );

    const sameAsCandidate = result.candidates.instagram.find(
      (candidate) => candidate.url === "https://www.instagram.com/violetpelu"
    );
    expect(sameAsCandidate).toBeDefined();
    expect(sameAsCandidate?.signals).toContain("cross_ref_from_web");
  });

  it("does not select social candidates when no signals are verified", async () => {
    const result = await discoverHeuristicSources(makeLead(), "full", {
      fetchHtml: async (url) => {
        if (url.includes("facebook.com") || url.includes("instagram.com")) {
          return {
            status: 403,
            finalUrl: url,
            html: null,
            headers: {},
            fetchedAt: "2026-01-01T00:00:00.000Z",
            error: "http-403",
          };
        }

        return {
          status: 200,
          finalUrl: url,
          html: "<html><title>Peluquería Ñandú Montevideo</title></html>",
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    });

    expect(result.candidates.facebook[0]).toMatchObject({
      score: 0,
      signals: [],
      error: "http-403",
    });
    expect(result.candidates.instagram[0]).toMatchObject({
      score: 0,
      signals: [],
      error: "http-403",
    });
    expect(result.selected.facebook).toBeNull();
    expect(result.selected.instagram).toBeNull();
  });

  it("derives Uruguay WhatsApp from mobile phone", () => {
    const candidate = deriveWhatsappCandidate(makeLead(), ["99"]);
    expect(candidate?.number).toBe("+59899123456");
    expect(candidate?.url).toBe("https://wa.me/59899123456");
  });

  it("detects stale heuristic runs", () => {
    const old = { ran_at: "2026-01-01T00:00:00.000Z" };
    const now = Date.parse("2026-02-15T00:00:00.000Z");
    expect(isHeuristicStale(old, now)).toBe(true);
    expect(isHeuristicStale(null, now)).toBe(true);
  });
});
