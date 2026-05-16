import { beforeEach, describe, expect, it } from "vitest";
import { scoreLead } from "../../src/modules/scoring/index.js";
import { resetScoringConfigCache } from "../../src/modules/scoring/config.js";
import { resetSystemsGapConfigCache } from "../../src/modules/scoring/systems-gap-config.js";
import type { Lead, OperationalSystemsSignal } from "../../src/shared/types.js";

beforeEach(() => {
  resetScoringConfigCache();
  resetSystemsGapConfigCache();
});

function ops(overrides: Partial<OperationalSystemsSignal> = {}): OperationalSystemsSignal {
  return {
    booking_platforms: [],
    reservation_platforms: [],
    delivery_platforms: [],
    menu_links: [],
    menu_keywords: [],
    class_booking_platforms: [],
    app_store_links: [],
    catalog_keywords: [],
    contact_form: false,
    chat_widget: false,
    ecommerce_platforms: [],
    whatsapp_web_link: false,
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-id",
    place_id: "place-id",
    niche: "hairdresser",
    name: "Test Lead",
    address: null,
    rating: 4.7,
    review_count: 35,
    website: "https://example.com",
    whatsapp: null,
    phone: null,
    business_status: "OPERATIONAL",
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00.000Z",
      operational_systems: ops(),
    },
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

describe("scoreLead systems_gap", () => {
  it("hairdresser without booking scores booking + WhatsApp gaps", () => {
    const result = scoreLead(makeLead());
    expect(result.systems_gap_score).toBe(25);
    expect(result.score_breakdown.systems_gap.rules.map((r) => r.name)).toEqual([
      "booking_system_missing",
      "whatsapp_business_missing",
    ]);
  });

  it("hairdresser with booking avoids booking and dependent WhatsApp gaps", () => {
    const result = scoreLead(
      makeLead({
        digital_footprint: {
          fetched_at: "2026-01-01T00:00:00.000Z",
          operational_systems: ops({ booking_platforms: ["booksy.com"] }),
        },
      })
    );
    expect(result.systems_gap_score).toBe(0);
  });

  it("restaurant with menu, delivery, and reservations present scores zero", () => {
    const result = scoreLead(
      makeLead({
        niche: "restaurant",
        digital_footprint: {
          fetched_at: "2026-01-01T00:00:00.000Z",
          operational_systems: ops({
            menu_links: ["/menu-carta.pdf"],
            delivery_platforms: ["pedidosya.com"],
            reservation_platforms: ["reservando.uy"],
          }),
        },
      })
    );
    expect(result.systems_gap_score).toBe(0);
  });

  it("car dealer without catalog or contact form scores both gaps", () => {
    const result = scoreLead(makeLead({ niche: "car_dealer" }));
    expect(result.systems_gap_score).toBe(35);
    expect(result.systems_gap_breakdown.rules.map((r) => r.name)).toEqual([
      "online_catalog_missing",
      "contact_form_missing",
    ]);
  });

  it("skipped footprint does not infer HTML-dependent systems gaps", () => {
    const result = scoreLead(
      makeLead({
        digital_footprint: {
          skipped: true,
          reason: "no-website",
          fetched_at: "2026-01-01T00:00:00.000Z",
        },
      })
    );
    expect(result.systems_gap_score).toBe(0);
    expect(result.score_breakdown.systems_gap.rules).toEqual([]);
  });

  it("systems_gap_score flows through software sub-score into prospect_score", () => {
    // hairdresser without booking: sgScore=25. prospect now uses max(sub_scores), not bq*dg.
    const result = scoreLead(makeLead({ tags: ["no-website"] }));
    expect(result.systems_gap_score).toBe(25);
    expect(result.score_breakdown.sub_scores.software).toBe(25);
    expect(result.prospect_score).not.toBe(
      Math.floor((result.business_quality_score * result.digital_gap_score) / 100)
    );
  });
});
