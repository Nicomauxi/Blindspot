import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverOrphanedRuns } from "../../src/modules/pipeline/crash-recovery.js";

vi.mock("../../src/shared/supabase.js", () => {
  // Chainable mock that supports .eq().lt() and .eq().eq() patterns.
  const emptyResult = { error: null, data: [] };
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    chain["eq"] = vi.fn(() => ({ ...chain, eq: vi.fn(() => ({ ...emptyResult })) }));
    chain["lt"] = vi.fn(() => emptyResult);
    return chain;
  };
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });
  const mockSelect = vi.fn().mockReturnValue(makeChain());
  return {
    getSupabase: () => ({
      from: () => ({ select: mockSelect, update: mockUpdate }),
    }),
  };
});

describe("recoverOrphanedRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0 when no orphaned runs exist", async () => {
    const recovered = await recoverOrphanedRuns();
    expect(recovered).toBe(0);
  });
});
