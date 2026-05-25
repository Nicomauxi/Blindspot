import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import {
  listNicheAliasGroups,
  createNicheAliasGroup,
  updateNicheAliasGroup,
  deleteNicheAliasGroup,
  expandNiche,
} from "../../src/storage/niches.js";

function mockChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    ...overrides,
  };
  // Make all fns return the chain by default (for chaining), unless overridden
  for (const key of Object.keys(chain)) {
    if (typeof chain[key] === "function" && !(chain[key] as { mockReturnValue?: unknown }).mockReturnValue) {
      (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  }
  return chain;
}

describe("listNicheAliasGroups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all groups ordered by canonical", async () => {
    const rows = [
      { id: "1", canonical: "bar", aliases: ["pub"], created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "2", canonical: "restaurante", aliases: ["restaurant", "parrilla"], created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];
    const chain = mockChain({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await listNicheAliasGroups();

    expect(result).toEqual(rows);
    expect(mockFrom).toHaveBeenCalledWith("niche_aliases");
  });

  it("returns empty array when table is empty", async () => {
    const chain = mockChain({ order: vi.fn().mockResolvedValue({ data: null, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await listNicheAliasGroups();

    expect(result).toEqual([]);
  });

  it("throws on DB error", async () => {
    const chain = mockChain({ order: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }) });
    mockFrom.mockReturnValue(chain);

    await expect(listNicheAliasGroups()).rejects.toThrow("Failed to list niche alias groups");
  });
});

describe("createNicheAliasGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a new group and returns the created row", async () => {
    const newGroup = { id: "abc", canonical: "farmacia", aliases: ["pharmacy"], created_at: "2026-01-01", updated_at: "2026-01-01" };
    const chain = mockChain({ single: vi.fn().mockResolvedValue({ data: newGroup, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await createNicheAliasGroup("farmacia", ["pharmacy"]);

    expect(result).toEqual(newGroup);
    expect(chain.insert).toHaveBeenCalledWith({ canonical: "farmacia", aliases: ["pharmacy"] });
  });

  it("throws on duplicate canonical", async () => {
    const chain = mockChain({ single: vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate key" } }) });
    mockFrom.mockReturnValue(chain);

    await expect(createNicheAliasGroup("farmacia", [])).rejects.toThrow("Failed to create niche alias group");
  });
});

describe("updateNicheAliasGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns the modified group", async () => {
    const updated = { id: "abc", canonical: "farmacia", aliases: ["pharmacy", "botica"], created_at: "2026-01-01", updated_at: "2026-05-25" };
    const chain = mockChain({ single: vi.fn().mockResolvedValue({ data: updated, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await updateNicheAliasGroup("abc", "farmacia", ["pharmacy", "botica"]);

    expect(result).toEqual(updated);
    expect(chain.eq).toHaveBeenCalledWith("id", "abc");
  });

  it("throws on DB error", async () => {
    const chain = mockChain({ single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }) });
    mockFrom.mockReturnValue(chain);

    await expect(updateNicheAliasGroup("bad-id", "x", [])).rejects.toThrow("Failed to update niche alias group");
  });
});

describe("deleteNicheAliasGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the group by id", async () => {
    const chain = mockChain({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue(chain);

    await expect(deleteNicheAliasGroup("abc")).resolves.toBeUndefined();
    expect(chain.eq).toHaveBeenCalledWith("id", "abc");
  });

  it("throws on DB error", async () => {
    const chain = mockChain({ eq: vi.fn().mockResolvedValue({ error: { message: "constraint violation" } }) });
    mockFrom.mockReturnValue(chain);

    await expect(deleteNicheAliasGroup("abc")).rejects.toThrow("Failed to delete niche alias group");
  });
});

describe("expandNiche", () => {
  beforeEach(() => vi.clearAllMocks());

  const allGroups = [
    { canonical: "restaurante", aliases: ["restaurant", "parrilla"] },
    { canonical: "farmacia", aliases: ["pharmacy"] },
  ];

  it("returns all equivalents when niche matches canonical", async () => {
    const chain = mockChain({ select: vi.fn().mockResolvedValue({ data: allGroups, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await expandNiche("restaurante");

    expect(result).toHaveLength(3);
    expect(result).toContain("restaurante");
    expect(result).toContain("restaurant");
    expect(result).toContain("parrilla");
  });

  it("returns all equivalents when niche matches an alias", async () => {
    const chain = mockChain({ select: vi.fn().mockResolvedValue({ data: allGroups, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await expandNiche("parrilla");

    expect(result).toHaveLength(3);
    expect(result).toContain("restaurante");
    expect(result).toContain("restaurant");
    expect(result).toContain("parrilla");
  });

  it("returns [niche] when no alias group matches", async () => {
    const chain = mockChain({ select: vi.fn().mockResolvedValue({ data: allGroups, error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await expandNiche("veterinaria");

    expect(result).toEqual(["veterinaria"]);
  });

  it("returns [niche] when table is empty", async () => {
    const chain = mockChain({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    mockFrom.mockReturnValue(chain);

    const result = await expandNiche("bar");

    expect(result).toEqual(["bar"]);
  });

  it("throws on DB error", async () => {
    const chain = mockChain({ select: vi.fn().mockResolvedValue({ data: null, error: { message: "connection error" } }) });
    mockFrom.mockReturnValue(chain);

    await expect(expandNiche("bar")).rejects.toThrow("Failed to expand niche aliases");
  });
});
