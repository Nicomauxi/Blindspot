import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));
vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { getGooglePlacesBudgetStatus } from "../../src/storage/pipeline-config.js";

function makeBudgetChain(row: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    limit: vi.fn().mockReturnThis(),
  };
}

describe("getGooglePlacesBudgetStatus — budget cap enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when pipeline_config row is absent", async () => {
    mockFrom.mockReturnValue(makeBudgetChain(null));
    const result = await getGooglePlacesBudgetStatus();
    expect(result).toBeNull();
  });

  it("computes budget_remaining correctly", async () => {
    mockFrom.mockReturnValue(
      makeBudgetChain({
        google_places_budget_total: 200,
        google_places_budget_spent: 75,
        google_places_budget_month: new Date().toISOString().slice(0, 7), // N4.4b: spent del mes corriente
        google_places_alert_threshold: 50,
      })
    );
    const result = await getGooglePlacesBudgetStatus();
    expect(result?.budget_remaining).toBeCloseTo(125);
    expect(result?.budget_total).toBe(200);
    expect(result?.budget_spent).toBe(75);
  });

  it("marks over_alert when remaining < alert_threshold", async () => {
    mockFrom.mockReturnValue(
      makeBudgetChain({
        google_places_budget_total: 200,
        google_places_budget_spent: 165,
        google_places_budget_month: new Date().toISOString().slice(0, 7), // N4.4b: spent del mes corriente
        google_places_alert_threshold: 50,
      })
    );
    const result = await getGooglePlacesBudgetStatus();
    expect(result?.budget_remaining).toBeCloseTo(35);
    expect(result?.over_alert).toBe(true);
  });

  it("does not mark over_alert when remaining >= alert_threshold", async () => {
    mockFrom.mockReturnValue(
      makeBudgetChain({
        google_places_budget_total: 200,
        google_places_budget_spent: 100,
        google_places_budget_month: new Date().toISOString().slice(0, 7), // N4.4b: spent del mes corriente
        google_places_alert_threshold: 50,
      })
    );
    const result = await getGooglePlacesBudgetStatus();
    expect(result?.over_alert).toBe(false);
  });
});
