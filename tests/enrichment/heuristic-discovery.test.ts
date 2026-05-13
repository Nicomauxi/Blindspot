import { describe, expect, it, vi } from "vitest";
import {
  buildSingleWordCandidates,
  buildSlugVariants,
  buildWebsiteCandidates,
  deriveWhatsappCandidate,
  discoverHeuristicSources,
  isHeuristicStale,
  parseHeuristicConfig,
  slugifyBusinessName,
  tokenizeFromSlug,
} from "../../src/modules/enrichment/heuristic-discovery.js";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/shared/config.js", () => ({
  getConfig: vi.fn(() => ({
    HEURISTIC_REFRESH_DAYS: 30,
    DIRECTORY_REFRESH_DAYS: 30,
    SOCIAL_SEARCH_REFRESH_DAYS: 30,
  })),
}));

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
    systems_gap_score: null,
    prospect_score: null,
    score_breakdown: null,
    systems_gap_breakdown: null,
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
      "https://nandu.com.uy",
      "https://nandu.uy",
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

  it("buildSlugVariants uses custom descriptorWords", () => {
    expect(
      buildSlugVariants("Cancha Padel", {
        descriptorWords: new Map([["padel", "pdl"]]),
      })
    ).toEqual(["cancha", "cancha-pdl", "cancha-padel", "canchapadel"]);
  });

  it("buildSingleWordCandidates uses custom nicheStopWords", () => {
    const candidates = buildSingleWordCandidates(
      "Cancha Padel",
      ["com.uy"],
      null,
      new Set(),
      { nicheStopWords: new Set(["cancha"]) }
    );

    expect(candidates).not.toContain("https://cancha.com.uy");
    expect(candidates).toContain("https://padel.com.uy");
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

    expect(result.selected.website?.url).toBe("https://nandu.com.uy");
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

    expect(probedUrls.filter((url) => !url.includes("facebook.com") && !url.includes("instagram.com"))).toHaveLength(15);
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

  it("prepends additional website URLs, dedupes them, and keeps the probe limit", async () => {
    const probedUrls: string[] = [];
    const result = await discoverHeuristicSources(
      makeLead({ name: "Violet Peluquería", address: "Montevideo, Uruguay" }),
      "website-only",
      {
        fetchHtml: async (url) => {
          probedUrls.push(url);
          return {
            status: 200,
            finalUrl: url,
            html: url === "https://violet.com.uy" ? "Violet Peluquería Uruguay" : "",
            headers: {},
            fetchedAt: "2026-01-01T00:00:00.000Z",
          };
        },
      },
      { additionalWebsiteUrls: ["https://violet.com.uy", "https://violet.com.uy"] }
    );

    expect(probedUrls[0]).toBe("https://violet.com.uy");
    expect(probedUrls.filter((url) => url === "https://violet.com.uy")).toHaveLength(1);
    expect(result.candidates.website).toHaveLength(15);
  });

  it("uses single-word threshold for local Uruguay TLD website candidates", async () => {
    const fetchHtml = async (url: string) => ({
      status: 200,
      finalUrl: url,
      html: "<html><title>Local business</title></html>",
      headers: {},
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    const mood = await discoverHeuristicSources(
      makeLead({ name: "Urban mood gym", address: "Montevideo, Uruguay", phone: null }),
      "website-only",
      { fetchHtml },
      { additionalWebsiteUrls: ["https://mood.com.uy"] }
    );
    const amaya = await discoverHeuristicSources(
      makeLead({ name: "Amaya Motors Propios", address: "Montevideo, Uruguay", phone: null }),
      "website-only",
      { fetchHtml },
      { additionalWebsiteUrls: ["https://amaya.com.uy"] }
    );

    expect(mood.selected.website?.url).toBe("https://mood.com.uy");
    expect(amaya.selected.website?.url).toBe("https://amaya.com.uy");
  });

  it("uses the higher website threshold for generic single-word domains", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "Fitness Space Institute", address: "Montevideo, Uruguay", phone: null }),
      "website-only",
      {
        fetchHtml: async (url) => ({
          status: url === "https://space.com" ? 200 : 404,
          finalUrl: url,
          html: url === "https://space.com" ? "<html><title>Generic domain</title></html>" : null,
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      { additionalWebsiteUrls: ["https://space.com"] }
    );

    expect(result.candidates.website.find((candidate) => candidate.url === "https://space.com")?.score).toBe(0.35);
    expect(result.selected.website).toBeNull();
  });

  it("penalizes website candidates that redirect to a different apex domain", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "El Pato", address: "Montevideo", phone: null }),
      "website-only",
      {
        fetchHtml: async () => ({
          status: 200,
          finalUrl: "https://elpatomexicanfood.com",
          html: "<html><title>El Pato Montevideo</title></html>",
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      { additionalWebsiteUrls: ["https://elpato.com"] }
    );

    const candidate = result.candidates.website.find((entry) => entry.url === "https://elpato.com");
    expect(candidate?.signals).toEqual(["http-ok", "redirect-mismatch"]);
    expect(candidate?.score).toBe(0.27);
    expect(result.selected.website).toBeNull();
  });

  it("does not penalize same-apex redirects across subdomains", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "Urban mood gym", address: "Montevideo", phone: null }),
      "website-only",
      {
        fetchHtml: async () => ({
          status: 200,
          finalUrl: "https://www.mood.uy",
          html: "<html><title>Urban mood gym Montevideo</title></html>",
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      { additionalWebsiteUrls: ["https://mood.com.uy"] }
    );

    const candidate = result.candidates.website.find((entry) => entry.url === "https://mood.com.uy");
    expect(candidate?.signals).toEqual(["http-ok", "name-match", "city-match"]);
    expect(candidate?.score).toBe(0.9);
    expect(result.selected.website?.url).toBe("https://mood.com.uy");
  });

  it("does not penalize www redirects on the same apex domain", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "Lander Studio", address: "Montevideo", phone: null }),
      "website-only",
      {
        fetchHtml: async () => ({
          status: 200,
          finalUrl: "https://www.lander.com.uy",
          html: "<html><title>Lander Studio Montevideo</title></html>",
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      { additionalWebsiteUrls: ["https://lander.com.uy"] }
    );

    const candidate = result.candidates.website.find((entry) => entry.url === "https://lander.com.uy");
    expect(candidate?.signals).toEqual(["http-ok", "name-match", "city-match"]);
    expect(candidate?.score).toBe(0.9);
    expect(result.selected.website?.url).toBe("https://lander.com.uy");
  });

  it("keeps multi-word website candidates on the higher website threshold", async () => {
    const result = await discoverHeuristicSources(
      makeLead({ name: "Urban Mood Gym", address: "Montevideo, Uruguay", phone: null }),
      "website-only",
      {
        fetchHtml: async (url) => ({
          status: url === "https://urban-mood.com.uy" ? 200 : 404,
          finalUrl: url,
          html: url === "https://urban-mood.com.uy" ? "<html><title>Local business</title></html>" : null,
          headers: {},
          fetchedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      { additionalWebsiteUrls: ["https://urban-mood.com.uy"] }
    );

    expect(result.candidates.website.find((candidate) => candidate.url === "https://urban-mood.com.uy")?.score).toBe(0.35);
    expect(result.selected.website).toBeNull();
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

  it("does not generate individual candidates for niche sector stopwords", () => {
    const motorsCandidates = buildWebsiteCandidates(
      { name: "Zona Motors", address: null },
      ["com.uy"],
      {}
    );
    expect(motorsCandidates).not.toContain("https://motors.com.uy");

    const fitnessCandidates = buildWebsiteCandidates(
      { name: "Power Fitness", address: null },
      ["com.uy"],
      {}
    );
    expect(fitnessCandidates).not.toContain("https://fitness.com.uy");

    const coiffeurCandidates = buildWebsiteCandidates(
      { name: "Style Coiffeur", address: null },
      ["com.uy"],
      {}
    );
    expect(coiffeurCandidates).not.toContain("https://coiffeur.com.uy");
  });

  it("does not generate individual candidates for words shorter than 4 characters", () => {
    const candidates = buildWebsiteCandidates(
      { name: "Rio Mar Salud", address: null },
      ["com.uy"],
      {}
    );
    expect(candidates).not.toContain("https://rio.com.uy");
    expect(candidates).not.toContain("https://mar.com.uy");
    expect(candidates).toContain("https://salud.com.uy");
  });

  it("tokenizeFromSlug splits a business name into slug tokens", () => {
    expect(tokenizeFromSlug("Peluquería Ñandú")).toEqual(["peluqueria", "nandu"]);
    expect(tokenizeFromSlug("")).toEqual([]);
    expect(tokenizeFromSlug("Amaya Motors & Propios")).toEqual(["amaya", "motors", "y", "propios"]);
    expect(tokenizeFromSlug("Zona Motors")).toEqual(["zona", "motors"]);
  });

  it("buildWebsiteCandidates respects extraStopWords for single-word candidates", () => {
    const candidates = buildWebsiteCandidates(
      { name: "Amaya Salon", address: null },
      ["com.uy"],
      {},
      new Set(["amaya"])
    );
    expect(candidates).not.toContain("https://amaya.com.uy");
    expect(candidates).toContain("https://salon.com.uy");
  });

  it("buildWebsiteCandidates with empty extraStopWords behaves identically to no argument", () => {
    const withEmpty = buildWebsiteCandidates(
      { name: "Zona Tech", address: null },
      ["com.uy"],
      {},
      new Set()
    );
    const withoutArg = buildWebsiteCandidates(
      { name: "Zona Tech", address: null },
      ["com.uy"],
      {}
    );
    expect(withEmpty).toEqual(withoutArg);
  });

  it("geographic stop words: city names from config do not generate single-word candidates", () => {
    const saltoCandidates = buildWebsiteCandidates(
      { name: "Peluquería Salto", address: null },
      ["com.uy"],
      {}
    );
    expect(saltoCandidates).not.toContain("https://salto.com.uy");

    const colonCandidates = buildWebsiteCandidates(
      { name: "Gym Colón", address: null },
      ["com.uy"],
      {}
    );
    expect(colonCandidates).not.toContain("https://colon.com.uy");
  });

  it("geographic stop words: legacy geo words still filtered (now via config)", () => {
    const uruguayCandidates = buildWebsiteCandidates(
      { name: "Centro Uruguay", address: null },
      ["com.uy"],
      {}
    );
    expect(uruguayCandidates).not.toContain("https://uruguay.com.uy");

    const mvdCandidates = buildWebsiteCandidates(
      { name: "Salon MVD Bella", address: null },
      ["com.uy"],
      {}
    );
    expect(mvdCandidates).not.toContain("https://mvd.com.uy");
  });

  it("parseHeuristicConfig: geographic_stop_words defaults to empty array when absent", () => {
    const config = parseHeuristicConfig(`
heuristic_discovery:
  enabled: true
  thresholds: { website: 0.7, social: 0.6 }
  tld_priority: [com.uy]
  max_candidates_to_probe: 6
  mobile_prefixes_uy: ["91"]
`);
    expect(config.geographic_stop_words).toEqual([]);
  });

  it("parseHeuristicConfig: geographic_stop_words parsed when present", () => {
    const config = parseHeuristicConfig(`
heuristic_discovery:
  enabled: true
  thresholds: { website: 0.7, social: 0.6 }
  tld_priority: [com.uy]
  max_candidates_to_probe: 6
  mobile_prefixes_uy: ["91"]
  geographic_stop_words:
    - salto
    - rivera
`);
    expect(config.geographic_stop_words).toEqual(["salto", "rivera"]);
  });
});
