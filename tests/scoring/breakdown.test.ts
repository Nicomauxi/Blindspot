import { describe, expect, it } from "vitest";
import { getScoreBreakdownRules } from "../../src/modules/scoring/breakdown.js";
import type { ScoreBreakdown } from "../../src/modules/scoring/types.js";

function breakdown(): ScoreBreakdown {
  return {
    computed_at: "2026-01-01T00:00:00.000Z",
    config_version: 1,
    business_quality: { total: 85, rules: [] },
    digital_gap: {
      total: 55,
      rules: [
        { name: "no_website", weight: 35, matched_value: "no-website" },
        { name: "high_reviews_no_web", weight: 10, matched_value: "high-reviews-no-web" },
      ],
    },
    systems_gap: { total: 0, rules: [] },
    prospect: { formula: "max(sub_scores) * contactabilityMultiplier", total: 46 },
    sub_scores: {
      web_nuevo: 45,
      rediseno: 0,
      marketing: 0,
      software: 0,
      catalogo: 0,
      primary_offer: "web_nuevo",
    },
  };
}

describe("getScoreBreakdownRules", () => {
  it("returns the rules array for digital_gap", () => {
    expect(getScoreBreakdownRules(breakdown(), "digital_gap")).toEqual([
      { name: "no_website", weight: 35, matched_value: "no-website" },
      { name: "high_reviews_no_web", weight: 10, matched_value: "high-reviews-no-web" },
    ]);
  });

  it("returns an empty array for systems_gap when no rules matched", () => {
    expect(getScoreBreakdownRules(breakdown(), "systems_gap")).toEqual([]);
  });

  it("handles null or missing dimensions gracefully", () => {
    expect(getScoreBreakdownRules(null, "digital_gap")).toEqual([]);
    expect(getScoreBreakdownRules({ computed_at: "x" }, "digital_gap")).toEqual([]);
  });
});
