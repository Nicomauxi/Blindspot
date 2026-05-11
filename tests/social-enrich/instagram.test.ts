import { describe, expect, it, vi } from "vitest";
import { extractInstagramProfile } from "../../src/modules/social-enrich/instagram.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "beauty",
    name: "Salon Bella",
    address: "Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: ["ig-heuristic"],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_breakdown: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePage(extracted: unknown) {
  return {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => extracted),
    close: vi.fn(async () => undefined),
  };
}

function makeDomPage(input: {
  profileLinks: string[];
  footerLinks: string[];
}) {
  return {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fn: (arg: { blockedHosts: string[] }) => unknown, arg: { blockedHosts: string[] }) => {
      const previousDocument = (globalThis as { document?: unknown }).document;
      const profileRoot = {
        querySelectorAll: vi.fn(() => input.profileLinks.map((href) => ({ href }))),
      };
      const fakeDocument = {
        body: { innerText: "Salon Bella\nColor, corte y belleza en Montevideo" },
        querySelector: vi.fn((selector: string) => {
          if (selector === "meta[property='og:title']") {
            return { content: "Salon Bella (@salonbella) • Instagram photos and videos" };
          }
          if (
            selector === "meta[property='og:description']" ||
            selector === "meta[name='description']"
          ) {
            return { content: "Color, corte y belleza en Montevideo" };
          }
          return null;
        }),
        querySelectorAll: vi.fn((selector: string) => {
          if (selector === "header, main section, section[role='main']") return [profileRoot];
          if (selector === "a[href]") {
            return [...input.profileLinks, ...input.footerLinks].map((href) => ({ href }));
          }
          return [];
        }),
      };
      (globalThis as { document?: unknown }).document = fakeDocument;
      try {
        return fn(arg);
      } finally {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("extractInstagramProfile", () => {
  it("navigates with Playwright and extracts profile signals", async () => {
    const page = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo. hola@salonbella.uy 099123456",
      email: "hola@salonbella.uy",
      phone: "099123456",
      external_url: "https://salonbella.uy",
      has_contact_button: true,
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(page.goto).toHaveBeenCalledWith("https://instagram.com/salonbella", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 15_000 });
    expect(result).toMatchObject({
      url: "https://instagram.com/salonbella",
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo. hola@salonbella.uy 099123456",
      email: "hola@salonbella.uy",
      phone: "+59899123456",
      external_url: "https://salonbella.uy",
      has_contact_button: true,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signals).toEqual(
      expect.arrayContaining(["page_loaded", "name_match", "bio_extracted", "email_found", "phone_found"])
    );
  });

  it("returns null on navigation timeout or blocking without throwing", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => {
        throw new Error("networkidle timeout");
      }),
      evaluate: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    await expect(
      extractInstagramProfile(page, "https://instagram.com/blocked", makeLead())
    ).resolves.toBeNull();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("does not accept Meta footer links as external_url", async () => {
    const page = makeDomPage({
      profileLinks: [],
      footerLinks: ["https://about.meta.com/"],
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(result?.external_url).toBeNull();
  });

  it("default blocked hosts exclude Meta-owned profile links", async () => {
    const page = makeDomPage({
      profileLinks: ["https://about.meta.com/", "https://facebook.com/salonbella"],
      footerLinks: [],
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(result?.external_url).toBeNull();
  });

  it("uses custom blocked hosts and selects the next external profile link", async () => {
    const page = makeDomPage({
      profileLinks: ["https://linkhub.example/salonbella", "https://salonbella.uy"],
      footerLinks: [],
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead(),
      ["linkhub.example"]
    );

    expect(result?.external_url).toBe("https://salonbella.uy");
  });

  it("accepts a real profile bio link as external_url", async () => {
    const page = makeDomPage({
      profileLinks: ["https://amaya.com.uy"],
      footerLinks: ["https://about.meta.com/"],
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(result?.external_url).toBe("https://amaya.com.uy");
  });

  it("does not penalize an otherwise Uruguayan profile", async () => {
    const page = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo, Uruguay.",
      email: null,
      phone: null,
      external_url: "https://salonbella.uy",
      has_contact_button: false,
    });

    const result = await extractInstagramProfile(
      page,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(result?.confidence).toBe(0.9);
  });

  it("penalizes foreign geographic bio text by 0.4", async () => {
    const basePage = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo, Uruguay.",
      email: null,
      phone: null,
      external_url: "https://salonbella.uy",
      has_contact_button: false,
    });
    const foreignPage = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Tehuacán, México.",
      email: null,
      phone: null,
      external_url: "https://salonbella.uy",
      has_contact_button: false,
    });

    const base = await extractInstagramProfile(
      basePage,
      "https://instagram.com/salonbella",
      makeLead()
    );
    const foreign = await extractInstagramProfile(
      foreignPage,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(base?.confidence).toBe(0.9);
    expect(foreign?.confidence).toBe(0.5);
  });

  it("penalizes foreign external URL TLDs by 0.3", async () => {
    const basePage = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo, Uruguay.",
      email: null,
      phone: null,
      external_url: "https://salonbella.uy",
      has_contact_button: false,
    });
    const foreignPage = makePage({
      name: "Salon Bella",
      bio: "Color, corte y belleza en Montevideo, Uruguay.",
      email: null,
      phone: null,
      external_url: "https://salonbella.mx",
      has_contact_button: false,
    });

    const base = await extractInstagramProfile(
      basePage,
      "https://instagram.com/salonbella",
      makeLead()
    );
    const foreign = await extractInstagramProfile(
      foreignPage,
      "https://instagram.com/salonbella",
      makeLead()
    );

    expect(base?.confidence).toBe(0.9);
    expect(foreign?.confidence).toBe(0.6);
  });
});
