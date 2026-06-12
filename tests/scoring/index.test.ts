import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// Freeze time so timing-factor logic (days_in_pool, new_business_window) is stable.
// Fixture created_at = "2026-04-18" → with fake now = "2026-07-18" the lead is 91 days old:
//   - stale_penalty (-0.05) + new_business_window (+0.05) cancel out → timing_factor = 1.0 for neutral leads.
const FAKE_NOW = new Date("2026-07-18T00:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
  resetScoringConfigCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scoreLead", () => {
  it("profile A full enrichment → tier X, prospect=30 (v3)", () => {
    const result = scoreLead(profileA_full);
    expect(result.business_quality_score).toBe(50);
    expect(result.digital_gap_score).toBe(55);
    expect(result.prospect_score).toBe(30);
    expect(result.score_breakdown.contact_tier).toBe("X");
    expect(result.score_breakdown.sub_scores.web_nuevo).toBe(35);
    expect(result.score_breakdown.sub_scores.primary_offer).toBe("web_nuevo");
  });

  it("site_unreachable (no no-website tag) → dg=15 only, prospect=7 via rediseno en tier X", () => {
    // Invariant: enrichment returns skipped("no-website") before fetch attempt,
    // so site-unreachable cannot co-exist with no-website tag.
    // ssl-missing also cannot co-tag: fetch_error branch never sets footprint.ssl.
    const result = scoreLead(site_unreachable);
    expect(result.digital_gap_score).toBe(15);
    expect(result.business_quality_score).toBe(0);
    expect(result.prospect_score).toBe(7);
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

  it("email aislado suma score compuesto pero no alcanza tier A", () => {
    const lead = { ...empty_lead, tags: ["web-only-no-social"], canonical_fields: { email: "owner@example.com" } };
    const result = scoreLead(lead);
    expect(result.score_breakdown.sub_scores.marketing).toBe(28);
    expect(result.score_breakdown.contact_score).toBe(30); // F3.4: email 45→30
    expect(result.score_breakdown.contact_tier).toBe("C"); // 30 → tier C, no B
    expect(result.prospect_score).toBe(27);
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

  it("floor not round: el score compuesto sigue usando floor", () => {
    const lead = { ...empty_lead, tags: ["web-only-no-social"], canonical_fields: { email: "owner@example.com" } };
    const result = scoreLead(lead);
    expect(result.prospect_score).toBe(27);
    expect(Number.isInteger(result.prospect_score)).toBe(true);
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

  it("profile A no_enrichment → tier X, prospect=30 (v3)", () => {
    const result = scoreLead(profileA_no_enrichment);
    expect(result.business_quality_score).toBe(43);
    expect(result.digital_gap_score).toBe(35);
    expect(result.prospect_score).toBe(30);
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

  describe("days_in_pool timing adjustment", () => {
    it("fresh lead (< 7 days) → freshness_signal 'fresh' y days_in_pool=3 (v3)", () => {
      // v3 expresa la frescura vía freshness_signal/timing_bonus, no el timing_factor de v2
      // (que queda en 0). Ver buildScoreResultV3.
      vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z").getTime()); // 3 días después del fixture
      const result = scoreLead({ ...empty_lead, tags: ["no-website"] });
      expect(result.score_breakdown.days_in_pool).toBe(3);
      expect(result.score_breakdown.freshness_signal).toBe("fresh");
    });

    it("stale lead (> 90 days) gets stale_penalty in timing_factor when outside new_business_window", () => {
      // 2025-01-01 is well outside new_business_window (> 365d from fake now 2026-07-18)
      const stale = { ...empty_lead, created_at: "2025-01-01T00:00:00.000Z", tags: ["no-website"] };
      vi.setSystemTime(new Date("2026-07-18T00:00:00.000Z").getTime());
      const result = scoreLead(stale);
      // stale_penalty (-0.05), no new_business_window → timing_factor = 0.95 for neutral urgency lead
      expect(result.score_breakdown.timing_factor).toBeLessThan(1);
      expect(result.score_breakdown.days_in_pool).toBeGreaterThan(90);
    });

    it("scoreLead exposes days_in_pool in score_breakdown", () => {
      const result = scoreLead(empty_lead);
      expect(typeof result.score_breakdown.days_in_pool).toBe("number");
      expect(result.score_breakdown.days_in_pool).toBeGreaterThanOrEqual(0);
    });
  });

});
