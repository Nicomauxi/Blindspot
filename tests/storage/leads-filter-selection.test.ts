import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { countLeadsByFilterSelection } from "../../src/storage/leads.js";

function makeQueryChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return chain;
}

describe("countLeadsByFilterSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters only by contact_tier when specified", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 5;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    const count = await countLeadsByFilterSelection({ contact_tier: "A" });

    expect(mockFrom).toHaveBeenCalledWith("lead_dashboard");
    expect((chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("contact_tier", "A");
    expect(count).toBe(5);
  });

  it("applies missing_gps filter with .is('gps', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 12;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_gps: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("gps", null);
  });

  it("applies missing_address filter with .is('address', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 3;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_address: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("address", null);
  });

  it("applies missing_phone filter with .is('phone', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 8;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_phone: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("phone", null);
  });

  it("applies missing_email filter with .is('contact_email', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 20;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_email: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("contact_email", null);
  });

  it("applies multiple missing_* filters together", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 7;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_gps: true, missing_phone: true });

    const isArgs = (chain.is as ReturnType<typeof vi.fn>).mock.calls;
    expect(isArgs).toContainEqual(["gps", null]);
    expect(isArgs).toContainEqual(["phone", null]);
  });

  it("does not call .is() when missing_* flags are false or absent", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 0;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ contact_tier: "B", missing_gps: false });

    expect((chain.is as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("throws when the database returns an error", async () => {
    const chain = makeQueryChain();
    (chain as { count: null; error: { message: string } }).count = null;
    (chain as { error: { message: string } }).error = { message: "db timeout" };
    mockFrom.mockReturnValue(chain);

    await expect(countLeadsByFilterSelection({ missing_gps: true })).rejects.toThrow("db timeout");
  });
});
