import type { Lead } from "../../../src/shared/types.js";

function base(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "report-fixture-id",
    place_id: "report-fixture-place",
    name: "Test Business",
    address: null,
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
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// prospect=27, bq=50, dg=55 — fully scored with discovery+enrichment tags
export const fullScored = base({
  id: "report-full-1",
  place_id: "ChIJabcdef123",
  name: "Peluquería La Paloma",
  address: "Av. 18 de Julio 1234, Montevideo",
  phone: "+59899123456",
  rating: 4.7,
  review_count: 35,
  business_status: "OPERATIONAL",
  tags: ["profile:a", "no-website", "pixel-missing", "analytics-missing", "whatsapp-missing"],
  business_quality_score: 50,
  digital_gap_score: 55,
  systems_gap_score: 25,
  prospect_score: 27,
  score_breakdown: {
    computed_at: "2024-01-01T00:00:00Z",
    config_version: 1,
    business_quality: {
      total: 50,
      rules: [
        { name: "rating_excellent", weight: 25, matched_value: 4.7 },
        { name: "reviews_medium", weight: 15, matched_value: 35 },
        { name: "business_operational", weight: 10, matched_value: "OPERATIONAL" },
      ],
    },
    digital_gap: {
      total: 55,
      rules: [
        { name: "no_website", weight: 35, matched_value: true },
        { name: "pixel_missing", weight: 5, matched_value: true },
        { name: "analytics_missing", weight: 5, matched_value: true },
        { name: "whatsapp_missing", weight: 10, matched_value: true },
      ],
    },
    systems_gap: {
      total: 25,
      rules: [
        { name: "booking_system_missing", weight: 15, matched_value: "missing" },
        { name: "whatsapp_business_missing", weight: 10, matched_value: "missing" },
      ],
    },
    prospect: { formula: "business_quality * digital_gap / 100", total: 27 },
  },
  systems_gap_breakdown: {
    total: 25,
    rules: [
      { name: "booking_system_missing", weight: 15, matched_value: "missing" },
      { name: "whatsapp_business_missing", weight: 10, matched_value: "missing" },
    ],
  },
  digital_footprint: { skipped: true, reason: "no-website", fetched_at: "2024-01-01T00:00:00Z" },
  first_seen_run_id: "run-abc-123",
});

// prospect=0, bq=0, dg=25 — social-only presence, skipped footprint
export const fbOnly = base({
  id: "report-fb-1",
  place_id: "ChIJfbonly456",
  name: "Restaurante El Fogón",
  address: "Bulevar Artigas 500, Montevideo",
  phone: "+59899654321",
  rating: 4.2,
  review_count: 120,
  business_status: "OPERATIONAL",
  tags: ["profile:b", "fb-only-presence"],
  business_quality_score: 0,
  digital_gap_score: 25,
  systems_gap_score: 0,
  prospect_score: 0,
  score_breakdown: {
    computed_at: "2024-01-01T00:00:00Z",
    config_version: 1,
    business_quality: { total: 0, rules: [] },
    digital_gap: {
      total: 25,
      rules: [{ name: "fb_only", weight: 25, matched_value: true }],
    },
    systems_gap: { total: 0, rules: [] },
    prospect: { formula: "business_quality * digital_gap / 100", total: 0 },
  },
  systems_gap_breakdown: { total: 0, rules: [] },
  digital_footprint: { skipped: true, reason: "social-only", fetched_at: "2024-01-01T00:00:00Z" },
  first_seen_run_id: "run-abc-123",
});

// all scores null — lead not yet scored (pre-scoring run or old tags)
export const nullScore = base({
  id: "report-null-1",
  place_id: "ChIJnullscore789",
  name: "Ferretería Central",
  address: "25 de Mayo 300, Montevideo",
  phone: "+59899111222",
  rating: 4.3,
  review_count: 80,
  business_status: "OPERATIONAL",
  tags: ["no-website"],
  first_seen_run_id: "run-old-999",
});

// tildes + ampersand in name — exercises slugify and CSV special-char encoding
export const specialChars = base({
  id: "report-special-1",
  place_id: "ChIJspecialXYZ",
  name: "Café Ñoño & Más",
  address: "Rambla República de México 5890, Montevideo",
  phone: "+59899333444",
  rating: 4.5,
  review_count: 22,
  business_status: "OPERATIONAL",
  tags: ["profile:a", "no-website", "whatsapp-missing"],
  business_quality_score: 43,
  digital_gap_score: 45,
  systems_gap_score: 0,
  prospect_score: 19,
  score_breakdown: {
    computed_at: "2024-01-01T00:00:00Z",
    config_version: 1,
    business_quality: {
      total: 43,
      rules: [
        { name: "rating_excellent", weight: 25, matched_value: 4.5 },
        { name: "reviews_low", weight: 8, matched_value: 22 },
        { name: "business_operational", weight: 10, matched_value: "OPERATIONAL" },
      ],
    },
    digital_gap: {
      total: 45,
      rules: [
        { name: "no_website", weight: 35, matched_value: true },
        { name: "whatsapp_missing", weight: 10, matched_value: true },
      ],
    },
    systems_gap: { total: 0, rules: [] },
    prospect: { formula: "business_quality * digital_gap / 100", total: 19 },
  },
  systems_gap_breakdown: { total: 0, rules: [] },
  first_seen_run_id: "run-abc-123",
});
