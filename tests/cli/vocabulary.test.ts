import { beforeEach, describe, expect, it, vi } from "vitest";
import { vocabularyCommand } from "../../src/cli/commands/vocabulary.js";
import * as leads from "../../src/storage/leads.js";
import * as vocab from "../../src/storage/vocabulary.js";
import * as vocabModule from "../../src/modules/enrichment/vocabulary.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
}));

vi.mock("../../src/storage/vocabulary.js", () => ({
  rebuildVocabularyForNiche: vi.fn(),
  showVocabularyForNiche: vi.fn(),
}));

vi.mock("../../src/modules/enrichment/vocabulary.js", () => ({
  computeNicheStopWords: vi.fn(),
}));

function makeLeads(niche: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `lead-${niche}-${i}`,
    niche,
    name: `Business ${i}`,
  }));
}

describe("vocabularyCommand rebuild --all", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls computeNicheStopWords per niche and persists results", async () => {
    const allLeads = [
      ...makeLeads("hairdresser", 3),
      ...makeLeads("car_dealer", 2),
    ];
    vi.mocked(leads.loadAllLeads).mockResolvedValue(allLeads as never);
    vi.mocked(vocabModule.computeNicheStopWords)
      .mockReturnValueOnce(new Map([["salon", 3]]))
      .mockReturnValueOnce(new Map([["motors", 2]]));
    vi.mocked(vocab.rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await vocabularyCommand({ subcommand: "rebuild", all: true });

    expect(leads.loadAllLeads).toHaveBeenCalled();
    expect(vocabModule.computeNicheStopWords).toHaveBeenCalledTimes(2);
    expect(vocab.rebuildVocabularyForNiche).toHaveBeenCalledWith("hairdresser", new Map([["salon", 3]]));
    expect(vocab.rebuildVocabularyForNiche).toHaveBeenCalledWith("car_dealer", new Map([["motors", 2]]));
  });

  it("skips leads with null niche", async () => {
    const allLeads = [
      ...makeLeads("hairdresser", 2),
      { id: "no-niche", niche: null, name: "Unknown" },
    ];
    vi.mocked(leads.loadAllLeads).mockResolvedValue(allLeads as never);
    vi.mocked(vocabModule.computeNicheStopWords).mockReturnValue(new Map());
    vi.mocked(vocab.rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await vocabularyCommand({ subcommand: "rebuild", all: true });

    expect(vocabModule.computeNicheStopWords).toHaveBeenCalledTimes(1);
    expect(vocab.rebuildVocabularyForNiche).toHaveBeenCalledWith("hairdresser", expect.anything());
  });

  it("never passes niche='all' to rebuildVocabularyForNiche", async () => {
    const allLeads = makeLeads("hairdresser", 2);
    vi.mocked(leads.loadAllLeads).mockResolvedValue(allLeads as never);
    vi.mocked(vocabModule.computeNicheStopWords).mockReturnValue(new Map([["salon", 2]]));
    vi.mocked(vocab.rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await vocabularyCommand({ subcommand: "rebuild", all: true });

    const calls = vi.mocked(vocab.rebuildVocabularyForNiche).mock.calls;
    expect(calls.every(([niche]) => niche !== "all")).toBe(true);
  });

  it("resolves successfully when there are no leads", async () => {
    vi.mocked(leads.loadAllLeads).mockResolvedValue([]);

    await expect(
      vocabularyCommand({ subcommand: "rebuild", all: true })
    ).resolves.not.toThrow();

    expect(vocab.rebuildVocabularyForNiche).not.toHaveBeenCalled();
  });
});

describe("vocabularyCommand show --niche", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls showVocabularyForNiche and prints rows", async () => {
    const rows = [
      { word: "salon", count: 5, source: "computed" },
      { word: "center", count: 0, source: "seed" },
    ];
    vi.mocked(vocab.showVocabularyForNiche).mockResolvedValue(rows);
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await vocabularyCommand({ subcommand: "show", niche: "hairdresser" });

    expect(vocab.showVocabularyForNiche).toHaveBeenCalledWith("hairdresser");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects when niche is missing on show subcommand", async () => {
    await expect(
      vocabularyCommand({ subcommand: "show" })
    ).rejects.toThrow();
  });
});
