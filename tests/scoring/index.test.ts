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
  it("profile A full enrichment → bq=50, dg=55, prospect=40 (web_nuevo=35 + rating bonus 5)", () => {
    const result = scoreLead(profileA_full);
    expect(result.business_quality_score).toBe(50);
    expect(result.digital_gap_score).toBe(55);
    expect(result.prospect_score).toBe(40); // floor(35 * 1.0 * 1.0) + 5 (rating=4.7 >= 4.3)
    expect(result.score_breakdown.sub_scores.web_nuevo).toBe(35);
    expect(result.score_breakdown.sub_scores.primary_offer).toBe("web_nuevo");
  });

  it("site_unreachable (no no-website tag) → dg=15 only, prospect=15 via rediseno sub-score", () => {
    // Invariant: enrichment returns skipped("no-website") before fetch attempt,
    // so site-unreachable cannot co-exist with no-website tag.
    // ssl-missing also cannot co-tag: fetch_error branch never sets footprint.ssl.
    const result = scoreLead(site_unreachable);
    expect(result.digital_gap_score).toBe(15);
    expect(result.business_quality_score).toBe(0);
    expect(result.prospect_score).toBe(15);
    expect(result.score_breakdown.sub_scores.rediseno).toBe(15);
    expect(result.score_breakdown.sub_scores.primary_offer).toBe("rediseno");
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

  it("high-reviews-no-web stacks as +10 digital_gap", () => {
    const withoutTag = scoreLead({ ...empty_lead, tags: ["no-website"] });
    const withTag = scoreLead({
      ...empty_lead,
      tags: ["no-website", "high-reviews-no-web"],
    });

    expect(withTag.digital_gap_score).toBe(withoutTag.digital_gap_score + 10);
    expect(withTag.score_breakdown.digital_gap.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "high_reviews_no_web", weight: 10 }),
      ])
    );
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

  it("prospect_score: floor(max(sub_scores) * contactabilityMultiplier)", () => {
    // web-only-no-social → marketing=28. With email → multiplier=1.2 → 28*1.2=33.6 → floor=33
    const lead = { ...empty_lead, tags: ["web-only-no-social"], canonical_fields: { email: "owner@example.com" } };
    const result = scoreLead(lead);
    expect(result.score_breakdown.sub_scores.marketing).toBe(28);
    expect(result.prospect_score).toBe(33); // floor(28 * 1.2) = floor(33.6) = 33, not ceil=34
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

  it("floor not round: web-only-no-social + email → 33 not ceil(33.6)=34", () => {
    // marketing=28, multiplier=1.2 → 28*1.2=33.6 → Math.floor=33, Math.ceil=34
    const lead = { ...empty_lead, tags: ["web-only-no-social"], canonical_fields: { email: "owner@example.com" } };
    const result = scoreLead(lead);
    expect(result.prospect_score).toBe(33);
    expect(result.prospect_score).not.toBe(34);
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

  it("profile A no_enrichment → bq=43, dg=35, prospect=40 (web_nuevo=35 + rating bonus 5)", () => {
    const result = scoreLead(profileA_no_enrichment);
    expect(result.business_quality_score).toBe(43);
    expect(result.digital_gap_score).toBe(35);
    expect(result.prospect_score).toBe(40); // floor(35 * 1.0 * 1.0) + 5 (rating=4.5 >= 4.3)
  });

  it("clamps digital_gap to 0 after summing negative weights", () => {
    const result = scoreLead({ ...empty_lead, tags: ["chat-widget"] });
    expect(result.digital_gap_score).toBe(0);
    expect(result.score_breakdown.digital_gap.rules).toContainEqual(
      expect.objectContaining({ name: "chat_widget_present", weight: -3 })
    );
  });

  it("chat-widget-missing adds +3 digital_gap", () => {
    const result = scoreLead({ ...empty_lead, tags: ["chat-widget-missing"] });

    expect(result.digital_gap_score).toBe(3);
    expect(result.score_breakdown.digital_gap.rules).toContainEqual(
      expect.objectContaining({ name: "chat_widget_missing", weight: 3 })
    );
  });

  it("chat-widget subtracts 3 digital_gap before clamp", () => {
    const result = scoreLead({ ...empty_lead, tags: ["pixel-missing", "chat-widget"] });

    expect(result.digital_gap_score).toBe(2);
    expect(result.score_breakdown.digital_gap.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "pixel_missing", weight: 5 }),
        expect.objectContaining({ name: "chat_widget_present", weight: -3 }),
      ])
    );
  });

  it("chat widget present and missing tags cancel if bad data contains both", () => {
    const result = scoreLead({
      ...empty_lead,
      tags: ["chat-widget", "chat-widget-missing"],
    });

    expect(result.digital_gap_score).toBe(0);
    expect(result.score_breakdown.digital_gap.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "chat_widget_present", weight: -3 }),
        expect.objectContaining({ name: "chat_widget_missing", weight: 3 }),
      ])
    );
  });

});
