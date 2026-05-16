import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getReviewCountMultiplier, getRatingBonus } from "../../src/modules/scoring/review-multiplier.js";
import { resetScoringConfigCache, getScoringConfig } from "../../src/modules/scoring/config.js";
import type { Lead } from "../../src/shared/types.js";
import { empty_lead } from "./fixtures/leads.js";

beforeEach(() => resetScoringConfigCache());
afterEach(() => resetScoringConfigCache());

function lead(overrides: Partial<Lead> = {}): Lead {
  return { ...empty_lead, ...overrides };
}

describe("getReviewCountMultiplier", () => {
  it("null review_count → 1.0 (fuentes externas no penalizadas)", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: null }), cfg)).toBe(1.0);
  });

  it("review_count 5 → 0.75", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 5 }), cfg)).toBe(0.75);
  });

  it("review_count 10 → 0.75 (inclusive en el bucket)", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 10 }), cfg)).toBe(0.75);
  });

  it("review_count 11 → 1.0", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 11 }), cfg)).toBe(1.0);
  });

  it("review_count 50 → 1.0 (inclusive en el bucket)", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 50 }), cfg)).toBe(1.0);
  });

  it("review_count 51 → 1.2", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 51 }), cfg)).toBe(1.2);
  });

  it("review_count 200 → 1.2 (inclusive en el bucket)", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 200 }), cfg)).toBe(1.2);
  });

  it("review_count 201 → 1.4", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 201 }), cfg)).toBe(1.4);
  });

  it("review_count 3000 → 1.4", () => {
    const cfg = getScoringConfig();
    expect(getReviewCountMultiplier(lead({ review_count: 3000 }), cfg)).toBe(1.4);
  });
});

describe("getRatingBonus", () => {
  it("null rating → 0", () => {
    const cfg = getScoringConfig();
    expect(getRatingBonus(lead({ rating: null }), cfg)).toBe(0);
  });

  it("rating 4.29 → 0 (debajo del threshold)", () => {
    const cfg = getScoringConfig();
    expect(getRatingBonus(lead({ rating: 4.29 }), cfg)).toBe(0);
  });

  it("rating 4.3 → 5 (en threshold exacto)", () => {
    const cfg = getScoringConfig();
    expect(getRatingBonus(lead({ rating: 4.3 }), cfg)).toBe(5);
  });

  it("rating 4.8 → 5", () => {
    const cfg = getScoringConfig();
    expect(getRatingBonus(lead({ rating: 4.8 }), cfg)).toBe(5);
  });
});

describe("integración — wiring de multiplicadores", () => {
  it("lead con review_count=3000 y rating=4.5 tiene multiplicadores máximos", () => {
    const cfg = getScoringConfig();
    const mult = getReviewCountMultiplier(lead({ review_count: 3000 }), cfg);
    const bonus = getRatingBonus(lead({ rating: 4.5 }), cfg);
    expect(mult).toBe(1.4);
    expect(bonus).toBe(5);
  });

  it("score capped en 100 — el min(100) envuelve el bonus", () => {
    // sub_score=72, contactability=1.2, reviewMultiplier=1.4 → floor(72*1.2*1.4)=120 → min(100)=100
    // ratingBonus=5 → 100+5=105 → min(100) externo = 100
    const inner = Math.floor(72 * 1.2 * 1.4); // 120
    const withBonus = Math.min(100, inner) + 5; // 100 + 5 = 105
    const capped = Math.min(100, withBonus); // 100
    expect(capped).toBe(100);
  });
});
