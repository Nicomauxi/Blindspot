import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverOrphanedRuns } from "../../src/modules/pipeline/crash-recovery.js";

vi.mock("../../src/shared/supabase.js", () => {
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });
  const mockSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ error: null, data: [] }),
  });
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
