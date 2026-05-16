import { describe, it, expect } from "vitest";
import { evaluateRule } from "../../src/modules/scoring/evaluator.js";
import type { ScoringRule } from "../../src/modules/scoring/types.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "test-id",
    place_id: "test-place",
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

function rule(partial: Omit<ScoringRule, "weight"> & { weight?: number }): ScoringRule {
  return { weight: 10, ...partial };
}

describe("evaluateRule — field conditions", () => {
  it("eq matches when field equals value", () => {
    const lead = makeLead({ business_status: "OPERATIONAL" });
    const r = rule({ name: "biz_op", condition: { field: "business_status", op: "eq", value: "OPERATIONAL" } });
    const { matched, value } = evaluateRule(r, lead);
    expect(matched).toBe(true);
    expect(value).toBe("OPERATIONAL");
  });

  it("eq does not match when field differs", () => {
    const lead = makeLead({ business_status: "CLOSED" });
    const r = rule({ name: "biz_op", condition: { field: "business_status", op: "eq", value: "OPERATIONAL" } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("neq matches when field differs from value", () => {
    const lead = makeLead({ source: "mintur" } as Partial<Lead>);
    const r = rule({ name: "ext_src", condition: { field: "source", op: "neq", value: "google_places" } });
    const { matched, value } = evaluateRule(r, lead);
    expect(matched).toBe(true);
    expect(value).toBe("mintur");
  });

  it("neq does not match when field equals value", () => {
    const lead = makeLead({ source: "google_places" } as Partial<Lead>);
    const r = rule({ name: "ext_src", condition: { field: "source", op: "neq", value: "google_places" } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("neq devuelve matched:false cuando el campo es null (limitación conocida: null-guard en evaluateRule:23)", () => {
    const lead = makeLead();
    const r = rule({ name: "ext_src", condition: { field: "source", op: "neq", value: "google_places" } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("gte matches at exact boundary (inclusive)", () => {
    const lead = makeLead({ rating: 4.5 });
    const r = rule({ name: "rating_excellent", condition: { field: "rating", op: "gte", value: 4.5 } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("gte does not match below boundary", () => {
    const lead = makeLead({ rating: 4.4 });
    const r = rule({ name: "rating_excellent", condition: { field: "rating", op: "gte", value: 4.5 } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("lte matches at exact boundary (inclusive)", () => {
    const lead = makeLead({ review_count: 50 });
    const r = rule({ name: "few_reviews", condition: { field: "review_count", op: "lte", value: 50 } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("between matches at lower bound (inclusive)", () => {
    const lead = makeLead({ review_count: 30 });
    const r = rule({ name: "reviews_medium", condition: { field: "review_count", op: "between", value: [30, 100] } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("between matches at upper bound (inclusive)", () => {
    const lead = makeLead({ review_count: 100 });
    const r = rule({ name: "reviews_medium", condition: { field: "review_count", op: "between", value: [30, 100] } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("between does not match below lower bound", () => {
    const lead = makeLead({ review_count: 29 });
    const r = rule({ name: "reviews_medium", condition: { field: "review_count", op: "between", value: [30, 100] } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("between does not match above upper bound", () => {
    const lead = makeLead({ review_count: 101 });
    const r = rule({ name: "reviews_medium", condition: { field: "review_count", op: "between", value: [30, 100] } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });

  it("resolves dot-notation field when value exists", () => {
    const lead = makeLead({ google_data: { photos_count: 10 } });
    const r = rule({ name: "has_photos", condition: { field: "google_data.photos_count", op: "gte", value: 5 } });
    const { matched, value } = evaluateRule(r, lead);
    expect(matched).toBe(true);
    expect(value).toBe(10);
  });

  it("returns matched:false without throwing when dot-notation field is absent", () => {
    // google_data.photos_count does not exist today — Fase 3 tolerance requirement
    const lead = makeLead({ google_data: {} });
    const r = rule({ name: "has_photos", condition: { field: "google_data.photos_count", op: "gte", value: 5 } });
    expect(() => evaluateRule(r, lead)).not.toThrow();
    expect(evaluateRule(r, lead).matched).toBe(false);
  });
});

describe("evaluateRule — google_data derived fields (Fase 2 enrichment)", () => {
  it("photos_count gte 5 matches when photos_count=7", () => {
    const lead = makeLead({ google_data: { photos_count: 7 } });
    const r = rule({ name: "has_photos", weight: 10, condition: { field: "google_data.photos_count", op: "gte", value: 5 } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("has_hours eq true matches when has_hours=true", () => {
    const lead = makeLead({ google_data: { has_hours: true } });
    const r = rule({ name: "has_hours", weight: 5, condition: { field: "google_data.has_hours", op: "eq", value: true } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("has_recent_reviews eq true matches when has_recent_reviews=true", () => {
    const lead = makeLead({ google_data: { has_recent_reviews: true } });
    const r = rule({ name: "has_recent_reviews", weight: 10, condition: { field: "google_data.has_recent_reviews", op: "eq", value: true } });
    expect(evaluateRule(r, lead).matched).toBe(true);
  });

  it("photos_count=0 does not match has_photos rule (gte 5)", () => {
    const lead = makeLead({ google_data: { photos_count: 0 } });
    const r = rule({ name: "has_photos", weight: 10, condition: { field: "google_data.photos_count", op: "gte", value: 5 } });
    expect(evaluateRule(r, lead).matched).toBe(false);
  });
});

describe("evaluateRule — tag conditions", () => {
  it("matches when tag is present in lead.tags", () => {
    const lead = makeLead({ tags: ["no-website", "pixel-missing"] });
    const r = rule({ name: "no_website", condition: { tag: "no-website" } });
    const { matched, value } = evaluateRule(r, lead);
    expect(matched).toBe(true);
    expect(value).toBe("no-website");
  });

  it("does not match when tag is absent", () => {
    const lead = makeLead({ tags: ["pixel-missing"] });
    const r = rule({ name: "no_website", condition: { tag: "no-website" } });
    const { matched, value } = evaluateRule(r, lead);
    expect(matched).toBe(false);
    expect(value).toBeNull();
  });
});
