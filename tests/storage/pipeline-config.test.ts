import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

import { incrementGooglePlacesBudgetSpent } from "../../src/storage/pipeline-config.js";

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
