import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

import { incrementGooglePlacesBudgetSpent, backfillGooglePlacesBudget } from "../../src/storage/pipeline-config.js";

describe("incrementGooglePlacesBudgetSpent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for zero or negative amount", async () => {
    expect(await incrementGooglePlacesBudgetSpent(0)).toBeNull();
    expect(await incrementGooglePlacesBudgetSpent(-1)).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls the atomic RPC and returns the result", async () => {
    mockRpc.mockResolvedValue({
      data: [{ google_places_budget_spent: 15.5, google_places_budget_total: 80, over_budget: false }],
      error: null,
    });

    const result = await incrementGooglePlacesBudgetSpent(5.5);

    expect(mockRpc).toHaveBeenCalledWith("increment_gp_budget_spent", { amount: 5.5 });
    expect(result).toEqual({ budget_spent: 15.5, budget_total: 80, over_budget: false });
  });

  it("returns over_budget=true when spending exceeds total", async () => {
    mockRpc.mockResolvedValue({
      data: [{ google_places_budget_spent: 85, google_places_budget_total: 80, over_budget: true }],
      error: null,
    });

    const result = await incrementGooglePlacesBudgetSpent(10);

    expect(result?.over_budget).toBe(true);
    expect(result?.budget_spent).toBe(85);
  });

  it("throws when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "function not found" } });

    await expect(incrementGooglePlacesBudgetSpent(1)).rejects.toThrow(
      "incrementGooglePlacesBudgetSpent: function not found"
    );
  });

  it("returns null when RPC returns empty data", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await incrementGooglePlacesBudgetSpent(1);
    expect(result).toBeNull();
  });
});

describe("backfillGooglePlacesBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums only runs with estimated_cost_usd > 0 from current month", async () => {
    const runs = [
      { stats: { estimated_cost_usd: 5.0 } },
      { stats: { estimated_cost_usd: 3.5 } },
      { stats: { estimated_cost_usd: 0 } },
      { stats: null },
    ];
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: runs, error: null }),
      update: vi.fn().mockReturnThis(),
    });

    const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: runs, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnValue(updateChain),
      });

    const result = await backfillGooglePlacesBudget();

    expect(result.total_cost_usd).toBeCloseTo(8.5);
    expect(result.total_runs).toBe(2);
  });

  it("filters by finished_at >= start of current month", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: vi.fn().mockReturnValue(updateChain) });

    await backfillGooglePlacesBudget();

    expect(selectChain.gte).toHaveBeenCalledWith(
      "finished_at",
      expect.stringMatching(/^\d{4}-\d{2}-01T/)
    );
  });

  it("updates pipeline_config.google_places_budget_spent with the total", async () => {
    const runs = [{ stats: { estimated_cost_usd: 12.0 } }];
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: runs, error: null }),
    };
    const eqSpy = vi.fn().mockResolvedValue({ error: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy });
    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: updateSpy });

    await backfillGooglePlacesBudget();

    expect(updateSpy).toHaveBeenCalledWith({ google_places_budget_spent: 12.0 });
    expect(eqSpy).toHaveBeenCalledWith("id", "singleton");
  });

  it("throws if runs query fails", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    });

    await expect(backfillGooglePlacesBudget()).rejects.toThrow("backfillGooglePlacesBudget: db error");
  });

  it("throws if update fails", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const updateChain = { eq: vi.fn().mockResolvedValue({ error: { message: "update failed" } }) };
    mockFrom
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ update: vi.fn().mockReturnValue(updateChain) });

    await expect(backfillGooglePlacesBudget()).rejects.toThrow("backfillGooglePlacesBudget update failed: update failed");
  });
});
