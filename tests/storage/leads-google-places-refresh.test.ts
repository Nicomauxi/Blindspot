import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { applyGooglePlacesRefresh } from "../../src/storage/leads.js";

function makeUpdateChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    error: null,
    ...overrides,
  };
  return chain;
}

describe("applyGooglePlacesRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates all available fields from a full summary", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    const result = await applyGooglePlacesRefresh("lead-1", {
      displayName: { text: "Nuevo Nombre" },
      formattedAddress: "Calle 18, Montevideo",
      rating: 4.5,
      userRatingCount: 120,
      internationalPhoneNumber: "+598 98 123 456",
      websiteUri: "https://example.com",
      businessStatus: "OPERATIONAL",
      location: { latitude: -34.9011, longitude: -56.1645 },
    });

    expect(mockFrom).toHaveBeenCalledWith("leads");
    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.name).toBe("Nuevo Nombre");
    expect(updateArg.address).toBe("Calle 18, Montevideo");
    expect(updateArg.rating).toBe(4.5);
    expect(updateArg.review_count).toBe(120);
    expect(updateArg.phone).toBe("+598 98 123 456");
    expect(updateArg.website).toBe("https://example.com");
    expect(updateArg.business_status).toBe("OPERATIONAL");
    expect(updateArg.gps).toContain("POINT");
    expect((chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id", "lead-1");
    expect(result.fields_updated).toHaveLength(8);
  });

  it("skips absent fields — does not write undefined keys", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    await applyGooglePlacesRefresh("lead-2", { rating: 3.8 });

    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updateArg)).toEqual(["rating"]);
  });

  it("returns empty fields_updated and skips DB call when summary is empty", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    const result = await applyGooglePlacesRefresh("lead-3", {});

    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.fields_updated).toHaveLength(0);
  });

  it("skips GPS when only one coordinate is present", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    await applyGooglePlacesRefresh("lead-4", {
      rating: 2.0,
      location: { latitude: -34.9 },
    });

    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.gps).toBeUndefined();
    expect(updateArg.rating).toBe(2.0);
  });

  it("includes gps when both coordinates are present", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    const result = await applyGooglePlacesRefresh("lead-5", {
      location: { latitude: -34.9011, longitude: -56.1645 },
    });

    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.gps).toBe("SRID=4326;POINT(-56.1645 -34.9011)");
    expect(result.fields_updated).toContain("gps");
  });

  it("throws when DB returns an error", async () => {
    const chain = makeUpdateChain({ error: { message: "db error" } });
    (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    await expect(
      applyGooglePlacesRefresh("lead-6", { rating: 4.0 })
    ).rejects.toThrow("db error");
  });

  it("does not update name when displayName is absent", async () => {
    const chain = makeUpdateChain();
    mockFrom.mockReturnValue(chain);

    await applyGooglePlacesRefresh("lead-7", { businessStatus: "CLOSED_PERMANENTLY" });

    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.name).toBeUndefined();
    expect(updateArg.business_status).toBe("CLOSED_PERMANENTLY");
  });
});
