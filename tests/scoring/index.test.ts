import { describe, it, expect, beforeEach } from "vitest";
import { scoreLead } from "../../src/modules/scoring/index.js";
import { resetScoringConfigCache } from "../../src/modules/scoring/config.js";
import {
  profileA_full,
  profileA_no_enrichment,
  profileB_rich,
  with_fb_only,
  with_fb_and_no_website,
  with_website_heuristic_and_no_website,
  with_social_heuristics,
  site_unreachable,
  empty_lead,
} from "./fixtures/leads.js";

beforeEach(() => {
  resetScoringConfigCache();
});

describe("scoreLead", () => {
  it("profile A full enrichment → bq=50, dg=55, prospect=27", () => {
    const result = scoreLead(profileA_full);
    expect(result.business_quality_score).toBe(50);
    expect(result.digital_gap_score).toBe(55);
    expect(result.prospect_score).toBe(27);
  });

  it("site_unreachable (no no-website tag) → dg=15 only", () => {
    // Invariant: enrichment returns skipped("no-website") before fetch attempt,
    // so site-unreachable cannot co-exist with no-website tag.
    // ssl-missing also cannot co-tag: fetch_error branch never sets footprint.ssl.
    const result = scoreLead(site_unreachable);
    expect(result.digital_gap_score).toBe(15);
    expect(result.business_quality_score).toBe(0);
    expect(result.prospect_score).toBe(0);
  });

  it("fb-only and no-website → exclusion keeps no_website (35 > 25) → dg=35", () => {
    const result = scoreLead(with_fb_and_no_website);
    expect(result.digital_gap_score).toBe(35);
    const dgRules = result.score_breakdown.digital_gap.rules;
    expect(dgRules.map((r) => r.name)).toContain("no_website");
    expect(dgRules.map((r) => r.name)).not.toContain("fb_only");
  });

  it("website-heuristic scores lower digital_gap than confirmed no-website", () => {
    const result = scoreLead({
      ...with_website_heuristic_and_no_website,
      tags: ["website-heuristic"],
    });
    const dgRules = result.score_breakdown.digital_gap.rules.map((r) => r.name);
    expect(dgRules).toContain("website_heuristic");
    expect(dgRules).not.toContain("no_website");
    expect(result.digital_gap_score).toBe(20);
  });

  it("fb-heuristic and ig-heuristic are picked by scoring", () => {
    const result = scoreLead(with_social_heuristics);
    const dgRules = result.score_breakdown.digital_gap.rules;
    expect(dgRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "fb_heuristic", weight: 15 }),
        expect.objectContaining({ name: "ig_heuristic", weight: 15 }),
      ])
    );
  });

  it("empty lead → all scores are 0", () => {
    const result = scoreLead(empty_lead);
    expect(result.business_quality_score).toBe(0);
    expect(result.digital_gap_score).toBe(0);
    expect(result.prospect_score).toBe(0);
  });

  it("prospect_score arithmetic: floor(bq * dg / 100)", () => {
    // profileA_full: bq=50, dg=55 → 50*55/100 = 27.5 → floor = 27
    const result = scoreLead(profileA_full);
    expect(result.prospect_score).toBe(
      Math.floor(result.business_quality_score * result.digital_gap_score / 100)
    );
  });

  it("breakdown.rules contains ONLY post-exclusion rules (no excluded rules)", () => {
    // with_fb_and_no_website has both no_website and fb_only matched,
    // but mutual exclusion keeps only no_website
    const result = scoreLead(with_fb_and_no_website);
    const dgRuleNames = result.score_breakdown.digital_gap.rules.map((r) => r.name);
    expect(dgRuleNames).toEqual(["no_website"]);
  });

  it("idempotence (Test A): same bq/dg/prospect on two calls", () => {
    const first = scoreLead(profileA_full);
    const second = scoreLead(profileA_full);
    expect(second.business_quality_score).toBe(first.business_quality_score);
    expect(second.digital_gap_score).toBe(first.digital_gap_score);
    expect(second.prospect_score).toBe(first.prospect_score);
    expect(second.score_breakdown.business_quality.rules).toEqual(
      first.score_breakdown.business_quality.rules
    );
  });

  it("computed_at (Test B): is a valid ISO 8601 timestamp", () => {
    const result = scoreLead(profileA_full);
    const ts = result.score_breakdown.computed_at;
    expect(typeof ts).toBe("string");
    expect(isNaN(Date.parse(ts))).toBe(false);
    // Basic ISO format check: YYYY-MM-DDTHH:mm:ss...Z
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("floor not round: prospect=27 not ceil(27.5)=28", () => {
    // bq=50, dg=55 → 50*55/100 = 27.5 → Math.floor = 27, Math.ceil = 28
    const result = scoreLead(profileA_full);
    expect(result.prospect_score).toBe(27);
    expect(result.prospect_score).not.toBe(28);
  });

  it("google_data fields absent → matched:false, no throw", () => {
    // has_photos / has_hours / has_recent_reviews are not in google_data yet (Fase 5)
    const lead = { ...profileA_full, google_data: {} };
    expect(() => scoreLead(lead)).not.toThrow();
    // Those rules should not appear in the breakdown
    const bqRuleNames = scoreLead(lead).score_breakdown.business_quality.rules.map((r) => r.name);
    expect(bqRuleNames).not.toContain("has_photos");
    expect(bqRuleNames).not.toContain("has_hours");
    expect(bqRuleNames).not.toContain("has_recent_reviews");
  });

  it("prospect formula arithmetic: profile A no_enrichment → bq=43, dg=35, prospect=15", () => {
    const result = scoreLead(profileA_no_enrichment);
    expect(result.business_quality_score).toBe(43);
    expect(result.digital_gap_score).toBe(35);
    expect(result.prospect_score).toBe(15); // floor(43*35/100) = floor(15.05) = 15
  });
});
