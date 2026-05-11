import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverSocialSearch,
  getSocialSearchRefreshDays,
  isSocialSearchStale,
} from "../../src/modules/enrichment/social-search.js";
import * as configModule from "../../src/shared/config.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "car_dealer",
    name: "Amaya Motors Propios",
    address: "Bv. Jose Batlle y Ordonez 3848, 11600 Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
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
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function duckResult(input: {
  title: string;
  href: string;
  urlText: string;
  snippet: string;
}): string {
  return `
    <div class="result">
      <a class="result__a" href="${input.href}">${input.title}</a>
      <h2 class="result__title">${input.title}</h2>
      <a class="result__url">${input.urlText}</a>
      <a class="result__snippet">${input.snippet}</a>
    </div>
  `;
}

describe("social search discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses DuckDuckGo results, scores signals, decodes uddg URLs, and extracts phones", async () => {
    const fbHtml = duckResult({
      title: "AMAYA Motors UY | Montevideo",
      href: "/l/?uddg=https%3A%2F%2Ffacebook.com%2Famayamotorsusadosy0km",
      urlText: "facebook.com/amayamotorsusadosy0km",
      snippet: "Amaya Motors Propios Montevideo. Telefonos 098365592 y 091214809.",
    });
    const igHtml = duckResult({
      title: "Otra cuenta",
      href: "https://www.instagram.com/otra",
      urlText: "instagram.com/otra",
      snippet: "Sin coincidencia",
    });
    const fetchDuckDuckGo = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, html: fbHtml })
      .mockResolvedValueOnce({ status: 200, html: igHtml });
    const delay = vi.fn(async () => undefined);

    const result = await discoverSocialSearch(makeLead(), { fetchDuckDuckGo, delay });

    expect(fetchDuckDuckGo.mock.calls[0]?.[0]).toContain(
      "site%3Afacebook.com%20%22Amaya%20Motors%20Propios%22%20montevideo"
    );
    expect(delay).toHaveBeenCalledWith(500);
    expect(result.facebook).toMatchObject({
      best_url: "https://facebook.com/amayamotorsusadosy0km",
      additional_phones: ["+59898365592", "+59891214809"],
      confidence: 1.1,
    });
    expect(result.facebook.results[0]).toMatchObject({
      url: "https://facebook.com/amayamotorsusadosy0km",
      title: "AMAYA Motors UY | Montevideo",
      phones_found: ["+59898365592", "+59891214809"],
      signals: [
        "name_in_title",
        "name_in_snippet",
        "city_in_snippet",
        "phone_in_snippet",
        "url_matches_platform",
      ],
    });
    expect(result.instagram.best_url).toBeNull();
  });

  it("requires name_in_title even when the score reaches threshold", async () => {
    const html = duckResult({
      title: "Autos usados en Montevideo",
      href: "https://facebook.com/autos",
      urlText: "facebook.com/autos",
      snippet: "Amaya Motors Propios Montevideo 24879258",
    });
    const fetchDuckDuckGo = vi.fn(async () => ({ status: 200, html }));

    const result = await discoverSocialSearch(makeLead(), {
      fetchDuckDuckGo,
      delay: async () => undefined,
    });

    expect(result.facebook.results[0]?.score).toBeGreaterThanOrEqual(0.4);
    expect(result.facebook.best_url).toBeNull();
  });

  it("normalizes +598, mobile, and Montevideo landline phones", async () => {
    const html = duckResult({
      title: "Amaya Motors Propios",
      href: "https://facebook.com/amaya",
      urlText: "facebook.com/amaya",
      snippet: "Contactos +598 98765432, 098365592, 24879258",
    });
    const result = await discoverSocialSearch(makeLead(), {
      fetchDuckDuckGo: async () => ({ status: 200, html }),
      delay: async () => undefined,
    });

    expect(result.facebook.additional_phones).toEqual([
      "+59898765432",
      "+59898365592",
      "+59824879258",
    ]);
  });

  it("returns empty platform results on 4xx, 5xx, empty HTML, or network errors", async () => {
    const fetchDuckDuckGo = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, html: null, error: "http-429" })
      .mockRejectedValueOnce(new Error("network failed"));

    const result = await discoverSocialSearch(makeLead(), {
      fetchDuckDuckGo,
      delay: async () => undefined,
    });

    expect(result.facebook.results).toEqual([]);
    expect(result.facebook.best_url).toBeNull();
    expect(result.facebook.error).toBe("http-429");
    expect(result.instagram.results).toEqual([]);
    expect(result.instagram.best_url).toBeNull();
    expect(result.instagram.error).toContain("network failed");
  });

  it("treats non-200 DuckDuckGo responses as unavailable soft-blocks", async () => {
    const fetchDuckDuckGo = vi.fn(async () => ({
      status: 202,
      html: "<html><title>DuckDuckGo</title></html>",
    }));

    const result = await discoverSocialSearch(makeLead(), {
      fetchDuckDuckGo,
      delay: async () => undefined,
    });

    expect(result.facebook.results).toEqual([]);
    expect(result.facebook.error).toBe("http-202");
  });

  it("detects stale social search runs with SOCIAL_SEARCH_REFRESH_DAYS", () => {
    vi.spyOn(configModule, "getConfig").mockReturnValue({
      SOCIAL_SEARCH_REFRESH_DAYS: 10,
    } as ReturnType<typeof configModule.getConfig>);
    const old = { ran_at: "2026-01-01T00:00:00.000Z" };
    const now = Date.parse("2026-01-12T00:00:00.000Z");

    expect(getSocialSearchRefreshDays()).toBe(10);
    expect(isSocialSearchStale(old, now)).toBe(true);
    expect(isSocialSearchStale(null, now)).toBe(true);
  });
});
