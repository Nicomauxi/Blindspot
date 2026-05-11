import { describe, expect, it, vi, afterEach } from "vitest";
import {
  deriveDirectoryCitySlug,
  discoverDirectorySources,
  getDirectoryRefreshDays,
  isDirectoryStale,
  parseDirectoryConfig,
  resetDirectoryConfigCache,
} from "../../src/modules/enrichment/directory-discovery.js";
import * as configModule from "../../src/shared/config.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "hairdresser",
    name: "Violet Peluquería",
    address: "Hocquart 2049, Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: "24092395",
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

function htmlResult(url: string, html: string) {
  return {
    status: 200,
    finalUrl: url,
    html,
    headers: { "content-type": "text/html" },
    fetchedAt: "2026-01-01T00:00:00.000Z",
  };
}

function yeluCompany(id: number, name: string, phone: string | null = null) {
  return `
    <div class="company" data-cmpid="${id}">
      <h3><a href="/company/${id}/${name.toLowerCase().replace(/\s+/g, "-")}">${name}</a></h3>
      <div class="address">Hocquart 2049, Montevideo</div>
      ${phone ? `<div class="s"><i class="fa fa-phone"></i><span>${phone}</span></div>` : ""}
    </div>
  `;
}

describe("directory discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDirectoryConfigCache();
  });

  it("parses yelu config and keeps old configs disabled by default", () => {
    const full = parseDirectoryConfig(`
directory_discovery:
  enabled: true
  source: yelu.uy
  min_confidence_to_use: 60
  fetch_profile_page: true
  niche_category_map:
    hairdresser: Peluqueros
    other: null
`);
    expect(full).toEqual({
      enabled: true,
      source: "yelu.uy",
      min_confidence_to_use: 60,
      fetch_profile_page: true,
      niche_category_map: {
        hairdresser: "Peluqueros",
        other: null,
      },
    });

    expect(parseDirectoryConfig("heuristic_discovery: {}").enabled).toBe(false);
  });

  it("derives Montevideo from Uruguay address with postal code and department", () => {
    expect(deriveDirectoryCitySlug(
      "Hocquart 2049, 11800 Montevideo, Departamento de Montevideo, Uruguay"
    )).toBe("montevideo");
  });

  it("derives Montevideo from another Uruguay address with postal code and department", () => {
    expect(deriveDirectoryCitySlug(
      "Av. Gral. Flores 3378, 11600 Montevideo, Departamento de Montevideo, Uruguay"
    )).toBe("montevideo");
  });

  it("builds the category city URL and extracts yelu listing fields", async () => {
    const fetchHtml = vi.fn(async (url: string) => htmlResult(url, yeluCompany(123, "Violet Peluquería", "2409 2395")));

    const result = await discoverDirectorySources(makeLead(), { fetchHtml });

    expect(fetchHtml.mock.calls[0]?.[0]).toBe(
      "https://www.yelu.uy/category/Peluqueros/city:montevideo"
    );
    expect(result.query).toBe("Peluqueros montevideo");
    expect(result.candidates[0]).toMatchObject({
      directory_url: "https://www.yelu.uy/company/123/violet-peluqueria",
      name: "Violet Peluquería",
      address: "Hocquart 2049, Montevideo",
      phone: "2409 2395",
      confidence: 85,
      signals: ["phone_match", "name_match", "address_match"],
    });
  });

  it("matches phone numbers by their last 7 digits", async () => {
    const fetchHtml = vi.fn(async (url: string) => htmlResult(url, yeluCompany(321, "Otra Empresa", "2211 1732")));

    const result = await discoverDirectorySources(makeLead({ phone: "+598 2211 1732" }), { fetchHtml });

    expect(result.candidates[0]?.signals).toContain("phone_match");
  });

  it("does not match phone numbers when their last 7 digits differ", async () => {
    const fetchHtml = vi.fn(async (url: string) => htmlResult(url, yeluCompany(322, "Otra Empresa", "2400 5101")));

    const result = await discoverDirectorySources(makeLead({ phone: "+598 2211 1732" }), { fetchHtml });

    expect(result.candidates[0]?.signals).not.toContain("phone_match");
  });

  it("returns empty without fetching when niche maps to null", async () => {
    const fetchHtml = vi.fn(async (url: string) => htmlResult(url, yeluCompany(123, "Violet Peluquería", "2409 2395")));

    const result = await discoverDirectorySources(makeLead({ niche: "other" }), { fetchHtml });

    expect(fetchHtml).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
    expect(result.best_website).toBeNull();
  });

  it("uses profile website and mailto email when phone and name reach the threshold", async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes("/category/")) {
        return htmlResult(url, `
          <div class="company" data-cmpid="456">
            <h3><a href="/company/456/violet">Violet Peluquería</a></h3>
            <div class="address">Otra dirección 111, Montevideo</div>
            <div class="s"><i class="fa fa-phone"></i><span>24092395</span></div>
          </div>
        `);
      }

      return htmlResult(url, `
        <section>
          <a href="https://www.yelu.uy/category/Peluqueros">Yelu</a>
          <a href="https://violet.com.uy">Website</a>
          <a href="mailto:contacto@violet.com.uy">Email</a>
        </section>
      `);
    });

    const result = await discoverDirectorySources(makeLead(), { fetchHtml });

    expect(result.candidates[0]?.confidence).toBe(60);
    expect(fetchHtml.mock.calls[1]?.[0]).toBe("https://www.yelu.uy/company/456/violet");
    expect(result.best_website).toBe("https://violet.com.uy/");
    expect(result.candidates[0]?.email).toBe("contacto@violet.com.uy");
    expect(result.candidates[0]?.signals).toEqual([
      "phone_match",
      "name_match",
      "directory_website",
    ]);
  });

  it("fetches page 2 when page 1 has more than 20 candidates and no phone match", async () => {
    const firstPage = Array.from({ length: 21 }, (_value, index) => yeluCompany(index + 1, `Peluquería ${index + 1}`)).join("\n");
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes("/2/")) {
        return htmlResult(url, yeluCompany(99, "Violet Peluquería", "24092395"));
      }
      return htmlResult(url, firstPage);
    });

    const result = await discoverDirectorySources(makeLead(), { fetchHtml });

    expect(fetchHtml.mock.calls[1]?.[0]).toBe(
      "https://www.yelu.uy/category/Peluqueros/2/city:montevideo"
    );
    expect(result.candidates).toHaveLength(22);
    expect(result.candidates.some((candidate) => candidate.signals.includes("phone_match"))).toBe(true);
  });

  it("returns empty discovery on 429 without throwing", async () => {
    const fetchHtml = vi.fn(async (url: string) => ({
      status: 429,
      finalUrl: url,
      html: null,
      headers: {},
      fetchedAt: "2026-01-01T00:00:00.000Z",
      error: "http-429",
    }));

    await expect(discoverDirectorySources(makeLead(), { fetchHtml })).resolves.toMatchObject({
      candidates: [],
      best_website: null,
      error: "http-429",
    });
  });

  it("returns empty discovery on unexpected HTML structure", async () => {
    const fetchHtml = vi.fn(async (url: string) => htmlResult(url, "<html><p>Sin perfiles</p></html>"));

    const result = await discoverDirectorySources(makeLead(), { fetchHtml });

    expect(result.candidates).toEqual([]);
    expect(result.best_website).toBeNull();
    expect(result.error).toBe("unexpected-structure");
  });

  it("detects stale directory runs with DIRECTORY_REFRESH_DAYS", () => {
    vi.spyOn(configModule, "getConfig").mockReturnValue({
      DIRECTORY_REFRESH_DAYS: 10,
    } as ReturnType<typeof configModule.getConfig>);
    const old = { ran_at: "2026-01-01T00:00:00.000Z" };
    const now = Date.parse("2026-01-12T00:00:00.000Z");

    expect(getDirectoryRefreshDays()).toBe(10);
    expect(isDirectoryStale(old, now)).toBe(true);
    expect(isDirectoryStale(null, now)).toBe(true);
  });
});
