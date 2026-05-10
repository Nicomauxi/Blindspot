import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadFilterWordsForNiche,
  loadVocabularyForNiche,
  rebuildVocabularyForNiche,
  showVocabularyForNiche,
} from "../../src/storage/vocabulary.js";
import { getSupabase } from "../../src/shared/supabase.js";

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(),
}));

// Helper to build a Supabase select-chain mock that ends with a resolved value.
function buildSelectChain(resolvedValue: { data: unknown; error: unknown }) {
  const or = vi.fn().mockResolvedValue(resolvedValue);
  const select = vi.fn(() => ({ or }));
  const from = vi.fn(() => ({ select }));
  return { from, select, or };
}

describe("loadVocabularyForNiche", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty Set when no rows exist for the niche", async () => {
    const { from } = buildSelectChain({ data: [], error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadVocabularyForNiche("hairdresser");
    expect(result).toEqual(new Set());
  });

  it("returns a Set of words from niche and universal seed rows", async () => {
    const rows = [
      { word: "salon" },
      { word: "coiffeur" },
      { word: "center" },
    ];
    const { from } = buildSelectChain({ data: rows, error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadVocabularyForNiche("hairdresser");
    expect(result).toEqual(new Set(["salon", "coiffeur", "center"]));
  });

  it("returns empty Set on DB error (graceful degradation)", async () => {
    const { from } = buildSelectChain({ data: null, error: { message: "connection refused" } });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadVocabularyForNiche("hairdresser");
    expect(result).toEqual(new Set());
  });

  it("queries niche_vocabulary table for the given niche", async () => {
    const { from, select, or } = buildSelectChain({ data: [], error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    await loadVocabularyForNiche("car_dealer");
    expect(from).toHaveBeenCalledWith("niche_vocabulary");
    expect(select).toHaveBeenCalledWith("word");
    expect(or).toHaveBeenCalledWith(
      expect.stringContaining("car_dealer")
    );
  });
});

describe("loadFilterWordsForNiche", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty Set when no rows exist", async () => {
    const { from } = buildSelectChain({ data: [], error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadFilterWordsForNiche("hairdresser");
    expect(result).toEqual(new Set());
  });

  it("returns Set of words from matching rows", async () => {
    const rows = [{ word: "salon" }, { word: "center" }];
    const { from } = buildSelectChain({ data: rows, error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadFilterWordsForNiche("hairdresser");
    expect(result).toEqual(new Set(["salon", "center"]));
  });

  it("returns empty Set on DB error (graceful degradation)", async () => {
    const { from } = buildSelectChain({ data: null, error: { message: "timeout" } });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    const result = await loadFilterWordsForNiche("hairdresser");
    expect(result).toEqual(new Set());
  });

  it("queries with seed-always and count>=5 threshold in the filter", async () => {
    const { from, select, or } = buildSelectChain({ data: [], error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
    await loadFilterWordsForNiche("car_dealer");
    expect(from).toHaveBeenCalledWith("niche_vocabulary");
    expect(select).toHaveBeenCalledWith("word");
    const filterArg: string = or.mock.calls[0][0];
    expect(filterArg).toContain("car_dealer");
    expect(filterArg).toContain("seed");
    expect(filterArg).toContain("gte.5");
    expect(filterArg).toContain("all");
  });
});

describe("rebuildVocabularyForNiche", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes existing computed rows then inserts new ones", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteWhere = vi.fn(() => ({ eq: deleteEq }));
    const from = vi.fn((table: string) => {
      if (table === "niche_vocabulary") return { delete: vi.fn(() => ({ eq: deleteEq, and: deleteWhere })), upsert };
      return {};
    });

    // Simpler mock: just track calls on upsert and a delete chain
    const deleteChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const deleteCall = vi.fn(() => deleteChain);
    const fromMock = vi.fn(() => ({ delete: deleteCall, upsert }));
    vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);

    const wordCounts = new Map([["salon", 5], ["bella", 3]]);
    await rebuildVocabularyForNiche("hairdresser", wordCounts);

    expect(fromMock).toHaveBeenCalledWith("niche_vocabulary");
    expect(deleteCall).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ niche: "hairdresser", word: "salon", count: 5, source: "computed" }),
        expect.objectContaining({ niche: "hairdresser", word: "bella", count: 3, source: "computed" }),
      ]),
      expect.objectContaining({ onConflict: "niche,word" })
    );
  });

  it("does not write niche='all' rows even if given a wordCounts map", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const deleteChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const deleteCall = vi.fn(() => deleteChain);
    const fromMock = vi.fn(() => ({ delete: deleteCall, upsert }));
    vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);

    // Attempt to rebuild with niche='all' must throw
    await expect(rebuildVocabularyForNiche("all", new Map([["word", 3]]))).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("skips DB calls and resolves when wordCounts is empty", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const deleteChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const fromMock = vi.fn(() => ({ delete: vi.fn(() => deleteChain), upsert }));
    vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);

    await rebuildVocabularyForNiche("hairdresser", new Map());
    // No insert when nothing to write; delete still runs to clear stale computed rows
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("showVocabularyForNiche", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rows sorted by count desc", async () => {
    const rows = [
      { word: "salon", count: 5, source: "computed" },
      { word: "bella", count: 2, source: "computed" },
      { word: "center", count: 0, source: "seed" },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const fromMock = vi.fn(() => ({ select }));
    vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);

    const result = await showVocabularyForNiche("hairdresser");
    expect(result).toEqual(rows);
    expect(fromMock).toHaveBeenCalledWith("niche_vocabulary");
    expect(select).toHaveBeenCalledWith("word, count, source");
    expect(eq).toHaveBeenCalledWith("niche", "hairdresser");
    expect(order).toHaveBeenCalledWith("count", { ascending: false });
  });

  it("returns empty array on DB error", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db down" } });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const fromMock = vi.fn(() => ({ select }));
    vi.mocked(getSupabase).mockReturnValue({ from: fromMock } as never);

    const result = await showVocabularyForNiche("hairdresser");
    expect(result).toEqual([]);
  });
});
