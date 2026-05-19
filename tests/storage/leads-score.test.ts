import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLeadScore } from "../../src/storage/leads.js";
import { getSupabase } from "../../src/shared/supabase.js";

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(),
}));

describe("updateLeadScore", () => {
  const eq = vi.fn();
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));

  beforeEach(() => {
    vi.clearAllMocks();
    eq.mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
  });

  it("persists systems_gap fields with the rest of the score result", async () => {
    await updateLeadScore("lead-1", {
      business_quality_score: 50,
      digital_gap_score: 35,
      systems_gap_score: 25,
      prospect_score: 17,
      scoring_version: 2,
      contact_ready: true,
      systems_gap_breakdown: {
        total: 25,
        rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
      },
      score_breakdown: {
        computed_at: "2026-01-01T00:00:00.000Z",
        config_version: 2,
        business_quality: { total: 50, rules: [] },
        digital_gap: { total: 35, rules: [] },
        systems_gap: {
          total: 25,
          rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
        },
        prospect: { formula: "commercial_score_v2", total: 17 },
        sub_scores: {
          web_nuevo: 0,
          rediseno: 0,
          marketing: 0,
          software: 25,
          catalogo: 0,
          contacto_directo: 0,
          primary_offer: "software",
        },
        primary_offer: "software",
        source_quality_bonus: 0,
        contact_tier: "C",
        pitch_hook: "hook",
        urgency_signal: "low",
        gap_depth: 25,
        commercial_breadth: 0,
        business_quality_pts: 5,
        accessibility_factor: 0.9,
        timing_factor: 1,
        urgency_bonus: 0,
        inferred_state_summary: {
          has_delivery: false,
          has_pos: false,
          has_reservations: false,
          has_ecommerce: false,
          digitalization_level: null,
        },
      },
    });

    expect(from).toHaveBeenCalledWith("leads");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        business_quality_score: 50,
        digital_gap_score: 35,
        systems_gap_score: 25,
        prospect_score: 17,
        scoring_version: 2,
        contact_ready: true,
        systems_gap_breakdown: {
          total: 25,
          rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
        },
      })
    );
    expect(eq).toHaveBeenCalledWith("id", "lead-1");
  });
});
