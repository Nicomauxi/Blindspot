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
      systems_gap_breakdown: {
        total: 25,
        rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
      },
      score_breakdown: {
        computed_at: "2026-01-01T00:00:00.000Z",
        config_version: 1,
        business_quality: { total: 50, rules: [] },
        digital_gap: { total: 35, rules: [] },
        systems_gap: {
          total: 25,
          rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
        },
        prospect: { formula: "business_quality * digital_gap / 100", total: 17 },
      },
    });

    expect(from).toHaveBeenCalledWith("leads");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        business_quality_score: 50,
        digital_gap_score: 35,
        systems_gap_score: 25,
        prospect_score: 17,
        systems_gap_breakdown: {
          total: 25,
          rules: [{ name: "booking_system_missing", weight: 15, matched_value: "missing" }],
        },
      })
    );
    expect(eq).toHaveBeenCalledWith("id", "lead-1");
  });
});
