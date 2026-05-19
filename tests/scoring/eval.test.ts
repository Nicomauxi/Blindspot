import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import { buildScoreEvalReport } from "../../src/modules/scoring/eval.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    source: "google_places",
    external_id: null,
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "restaurant",
    name: "Test Business",
    address: "Montevideo",
    rating: 4.5,
    review_count: 80,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: "OPERATIONAL",
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: {},
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00.000Z",
      contact_emails: [],
      phone_confirmed: false,
      phone_alternatives: [],
      phone_classification: [],
      operational_systems: {
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
      },
    },
    inferred_state: null,
    gps: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: 70,
    scoring_version: 1,
    contact_ready: null,
    prospect_score_v1: 70,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    score_breakdown_v1: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildScoreEvalReport", () => {
  it("forces tier X leads out of the hot bucket", () => {
    const lead = makeLead({
      tags: ["no-website", "high-reviews-no-web", "pixel-missing", "analytics-missing"],
      prospect_score: 75,
      address: null,
      phone: null,
      whatsapp: null,
      website: null,
    });

    const report = buildScoreEvalReport([lead], { topCount: 10, goldSetSize: 10, generatedAt: "2026-05-18T00:00:00.000Z" });

    expect(report.criteria.tierXHot.count).toBe(0);
    expect(report.comparisons[0]?.v2ContactTier).toBe("X");
    expect(report.comparisons[0]?.v2Score).toBeLessThan(55);
  });

  it("penalizes franchises and activates direct-contact scoring for phone-only leads", () => {
    const franchise = makeLead({
      id: "franchise",
      place_id: "franchise-place",
      name: "Franchise",
      source: "osm",
      tags: ["no-website", "franchise-detected"],
      phone: "+59891234567",
      prospect_score: 50,
    });
    const independent = makeLead({
      id: "independent",
      place_id: "independent-place",
      name: "Independent",
      source: "osm",
      tags: ["no-website"],
      phone: "+59891234567",
      prospect_score: 50,
    });
    const contactOnly = makeLead({
      id: "contact-only",
      place_id: "contact-only-place",
      name: "Contact Only",
      source: "mintur",
      niche: "other",
      tags: [],
      phone: "+59821234567",
      prospect_score: 10,
      prospect_score_v1: 10,
      digital_footprint: null,
    });

    const report = buildScoreEvalReport([franchise, independent, contactOnly], {
      topCount: 10,
      goldSetSize: 10,
      generatedAt: "2026-05-18T00:00:00.000Z",
    });

    const franchiseRow = report.comparisons.find((row) => row.leadId === "franchise");
    const independentRow = report.comparisons.find((row) => row.leadId === "independent");
    const contactOnlyRow = report.comparisons.find((row) => row.leadId === "contact-only");

    expect(franchiseRow?.v2Score).toBeLessThan(independentRow?.v2Score ?? 0);
    expect(franchiseRow?.reasonSummary).toContain("franchise penalty");
    expect(contactOnlyRow?.v2PrimaryOffer).toBe("contacto_directo");
    expect(contactOnlyRow?.v2Score).toBeGreaterThan(contactOnlyRow?.v1Score ?? 0);
    expect(report.goldSetSeed.length).toBe(3);
  });
});
