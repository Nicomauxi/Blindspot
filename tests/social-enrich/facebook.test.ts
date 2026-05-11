import { describe, expect, it, vi } from "vitest";
import { extractFacebookProfile } from "../../src/modules/social-enrich/facebook.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "car_dealer",
    name: "Amaya Motors Propios",
    address: "Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: ["fb-heuristic"],
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

function makePage(extracted: unknown) {
  return {
    goto: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => extracted),
    close: vi.fn(async () => undefined),
  };
}

describe("extractFacebookProfile", () => {
  it("navigates with Playwright and extracts public page signals", async () => {
    const page = makePage({
      name: "AMAYA Motors Propios",
      email: "ventas@amaya.com.uy",
      phone: "098365592",
      website: "https://amaya.com.uy",
      description: "Venta de autos usados y 0km en Montevideo.",
      whatsapp_button: true,
    });

    const result = await extractFacebookProfile(
      page,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );

    expect(page.goto).toHaveBeenCalledWith("https://facebook.com/amayamotorsusadosy0km", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 15_000 });
    expect(result).toMatchObject({
      url: "https://facebook.com/amayamotorsusadosy0km",
      name: "AMAYA Motors Propios",
      email: "ventas@amaya.com.uy",
      phone: "+59898365592",
      website: "https://amaya.com.uy",
      description: "Venta de autos usados y 0km en Montevideo.",
      whatsapp_button: true,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signals).toEqual(
      expect.arrayContaining(["page_loaded", "name_match", "email_found", "phone_found", "whatsapp_button"])
    );
  });

  it("returns null on navigation timeout or blocking without throwing", async () => {
    const page = {
      goto: vi.fn(async () => {
        throw new Error("Timeout 15000ms exceeded");
      }),
      waitForLoadState: vi.fn(),
      evaluate: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    await expect(
      extractFacebookProfile(page, "https://facebook.com/blocked", makeLead())
    ).resolves.toBeNull();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("does not penalize an otherwise Uruguayan profile", async () => {
    const page = makePage({
      name: "Amaya Motors Propios",
      email: null,
      phone: null,
      website: "https://amaya.com.uy",
      description: "Venta de autos en Montevideo, Uruguay.",
      whatsapp_button: false,
    });

    const result = await extractFacebookProfile(
      page,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );

    expect(result?.confidence).toBe(0.8);
  });

  it("penalizes foreign geographic text by 0.4", async () => {
    const basePage = makePage({
      name: "Amaya Motors Propios",
      email: null,
      phone: null,
      website: "https://amaya.com.uy",
      description: "Venta de autos en Montevideo, Uruguay.",
      whatsapp_button: false,
    });
    const foreignPage = makePage({
      name: "Amaya Motors Propios",
      email: null,
      phone: null,
      website: "https://amaya.com.uy",
      description: "Venta de autos en Tehuacán, México.",
      whatsapp_button: false,
    });

    const base = await extractFacebookProfile(
      basePage,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );
    const foreign = await extractFacebookProfile(
      foreignPage,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );

    expect(base?.confidence).toBe(0.8);
    expect(foreign?.confidence).toBe(0.4);
  });

  it("penalizes foreign website TLDs by 0.3", async () => {
    const basePage = makePage({
      name: "Amaya Motors Propios",
      email: null,
      phone: null,
      website: "https://amaya.com.uy",
      description: "Venta de autos en Montevideo, Uruguay.",
      whatsapp_button: false,
    });
    const foreignPage = makePage({
      name: "Amaya Motors Propios",
      email: null,
      phone: null,
      website: "https://amaya.mx",
      description: "Venta de autos en Montevideo, Uruguay.",
      whatsapp_button: false,
    });

    const base = await extractFacebookProfile(
      basePage,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );
    const foreign = await extractFacebookProfile(
      foreignPage,
      "https://facebook.com/amayamotorsusadosy0km",
      makeLead()
    );

    expect(base?.confidence).toBe(0.8);
    expect(foreign?.confidence).toBe(0.5);
  });
});
