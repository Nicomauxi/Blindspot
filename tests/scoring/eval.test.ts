import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import { buildScoreEvalReport } from "../../src/modules/scoring/eval.js";
import { buildScoreResultV3 } from "../../src/modules/scoring/v3.js";
import { getScoringCalibrationConfig } from "../../src/modules/scoring/calibration-config.js";

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

function resolveActiveScenario() {
  const calibration = getScoringCalibrationConfig();
  const scenario = calibration.scenarios[calibration.default_scenario];
  if (!scenario) throw new Error(`Missing scenario: ${calibration.default_scenario}`);
  return { scenario, thresholds: scenario.preview_thresholds };
}

describe("buildScoreEvalReport", () => {
  it("scores the candidate column with the production v3 model (FS-12a)", () => {
    const { scenario, thresholds } = resolveActiveScenario();
    const leads = [
      makeLead({ id: "a", place_id: "pa", name: "Alpha", tags: ["no-website", "high-reviews-no-web"] }),
      makeLead({ id: "b", place_id: "pb", name: "Bravo", source: "mintur", niche: "other", phone: "+59899111222", tags: [] }),
    ];

    const report = buildScoreEvalReport(leads, { topCount: 10, goldSetSize: 10, generatedAt: "2026-05-18T00:00:00.000Z" });

    for (const lead of leads) {
      const expected = buildScoreResultV3(lead, scenario, thresholds);
      const row = report.comparisons.find((r) => r.leadId === lead.id);
      expect(row?.v3Score).toBe(expected.prospect_score);
    }
  });

  it("derives the hot threshold from the active scenario, not a hardcoded 55 (FS-12a)", () => {
    const { thresholds } = resolveActiveScenario();
    // Active scenario hybrid_bounded_v32_candidate uses very_good_min=58, not 55.
    expect(thresholds.very_good_min).toBe(58);
  });

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
    expect(report.comparisons[0]?.v3ContactTier).toBe("X");
    const { thresholds } = resolveActiveScenario();
    expect(report.comparisons[0]?.v3Score).toBeLessThan(thresholds.very_good_min);
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
      phone: "+59891234567", // móvil: el contacto directo del dueño (F3.3 baja el peso del fijo)
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

    expect(franchiseRow?.v3Score).toBeLessThan(independentRow?.v3Score ?? 0);
    expect(franchiseRow?.reasonSummary).toContain("franchise penalty");
    expect(contactOnlyRow?.v3PrimaryOffer).toBe("contacto_directo");
    expect(contactOnlyRow?.v3Score).toBeGreaterThan(contactOnlyRow?.v1Score ?? 0);
    expect(report.goldSetSeed.length).toBe(3);
  });
});
