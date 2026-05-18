import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { getAdminServicePricing } from "../../src/storage/service-pricing.js";

function buildChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe("getAdminServicePricing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns monthly_fee when admin pricing exists", async () => {
    buildChain({ data: { monthly_fee: 3000 }, error: null });
    const result = await getAdminServicePricing("delivery_system");
    expect(result).toBe(3000);
  });

  it("returns null when no record found", async () => {
    buildChain({ data: null, error: null });
    const result = await getAdminServicePricing("delivery_system");
    expect(result).toBeNull();
  });

  it("returns null on DB error", async () => {
    buildChain({ data: null, error: { message: "DB error" } });
    const result = await getAdminServicePricing("delivery_system");
    expect(result).toBeNull();
  });
});
