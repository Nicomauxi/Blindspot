import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import type { SocialActivityProfile } from "../../src/modules/social-enrich/social-activity.js";
import type { ParsedSocialDescription } from "../../src/modules/social-enrich/description-parse.js";
import { buildSocialCandidate, mergeSocialIntoCanonical } from "../../src/modules/social-enrich/social-canonical.js";

function profile(overrides: Partial<SocialActivityProfile> = {}): SocialActivityProfile {
  return {
    platform: "facebook",
    url: "https://facebook.com/ilbaretto",
    followers: 1200,
    following: null,
    posts: 300,
    likes: 1200,
    talking_about: 40,
    audience_tier: "medium",
    activity_status: "active",
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedSocialDescription> = {}): ParsedSocialDescription {
  return {
    raw_text: "x",
    phones: ["+59842445565"],
    emails: [],
    website: null,
    hours: null,
    offer: null,
    method: "regex",
    field_confidence: {},
    ...overrides,
  };
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1", place_id: "p", source: "google_places", external_id: "g", source_confidence: 0.9,
    source_data: null, data_confidence_score: null, contact_reliability_score: null,
    canonical_fields: null, corroborating_sources: [], lead_company_data: null, niche: "other",
    name: "N", address: null, rating: null, review_count: null, website: null, whatsapp: null,
    phone: null, business_status: null, tags: [], notes: null, state: "discovered",
    first_seen_run_id: null, last_seen_run_id: null, google_data: null, digital_footprint: null,
    inferred_state: null, gps: null, reviews_sample: null, business_quality_score: null,
    digital_gap_score: null, systems_gap_score: null, prospect_score: null, passed_filter: true,
    rejection_reasons: [], score_breakdown: null, systems_gap_breakdown: null, contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

describe("buildSocialCandidate", () => {
  it("usa source social_facebook y confianza activa para FB", () => {
    const c = buildSocialCandidate({ profile: profile(), parsed: parsed(), recencyDays: 10 });
    expect(c.source).toBe("social_facebook");
    expect(c.phone).toBe("+59842445565");
    expect(c.source_confidence).toBeGreaterThan(0.45);
  });

  it("cuenta abandonada => confianza piso (0.2)", () => {
    const c = buildSocialCandidate({ profile: profile({ activity_status: "abandoned" }), parsed: parsed(), recencyDays: 400 });
    expect(c.source_confidence).toBe(0.2);
  });
});

describe("mergeSocialIntoCanonical", () => {
  it("agrega teléfono social al lead sin teléfono previo", () => {
    const result = mergeSocialIntoCanonical(lead(), [
      { profile: profile(), parsed: parsed(), recencyDays: 5 },
    ]);
    const phone = result?.["phone"] as { value: string; sources: string[] } | undefined;
    expect(phone?.value).toBe("+59842445565");
    expect(phone?.sources).toContain("social_facebook");
  });

  it("teléfono de cuenta abandonada NO pisa el de Google (conflicto, alternativa)", () => {
    const base = lead({ phone: "+59899111222", canonical_fields: { phone: { value: "+59899111222", confidence: 0.9, sources: ["google_places"], conflict: false } } });
    const result = mergeSocialIntoCanonical(base, [
      { profile: profile({ activity_status: "abandoned" }), parsed: parsed({ phones: ["+59842445565"] }), recencyDays: 999 },
    ]);
    const phone = result?.["phone"] as { value: string; conflict: boolean; conflict_alternatives?: unknown[] } | undefined;
    expect(phone?.value).toBe("+59899111222");
    expect(phone?.conflict).toBe(true);
    expect(phone?.conflict_alternatives).toBeTruthy();
  });

  it("sin datos accionables devuelve null", () => {
    const result = mergeSocialIntoCanonical(lead(), [
      { profile: profile(), parsed: parsed({ phones: [], emails: [], website: null }), recencyDays: 5 },
    ]);
    expect(result).toBeNull();
  });
});
