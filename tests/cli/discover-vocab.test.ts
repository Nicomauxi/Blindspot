/**
 * Focused tests for the vocabulary rebuild triggered by discoverCommand.
 * Only tests the new vocabulary hook — existing discover behavior is exercised
 * by integration tests and the command's own internal logic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/discovery/places.js", () => ({
  fetchPlaceCandidates: vi.fn(),
  fetchPlaceDetails: vi.fn(),
  TEXT_SEARCH_FIELDS: "",
  DETAILS_FIELDS: "",
}));

vi.mock("../../src/modules/discovery/google-data-enricher.js", () => ({
  enrichWithDetails: vi.fn((raw: unknown) => raw),
}));

vi.mock("../../src/modules/discovery/filters.js", () => ({
  applyProfileFilter: vi.fn(),
  normalizeNiche: vi.fn((n: string) => n),
  tagCandidate: vi.fn(() => []),
}));

vi.mock("../../src/modules/discovery/config.js", () => ({
  getDiscoveryConfig: vi.fn(() => ({ social_domains: [], persist_rejected: false })),
  getProfileConfig: vi.fn(() => ({ min_rating: 4, min_reviews: 0, max_reviews: null, web_requirement: "none" })),
}));

vi.mock("../../src/storage/runs.js", () => ({
  createRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

vi.mock("../../src/storage/leads.js", () => ({
  upsertLeads: vi.fn(),
  loadAllLeads: vi.fn(),
}));

vi.mock("../../src/storage/vocabulary.js", () => ({
  rebuildVocabularyForNiche: vi.fn(),
}));

vi.mock("../../src/modules/enrichment/vocabulary.js", () => ({
  computeNicheStopWords: vi.fn(),
}));

import { discoverCommand } from "../../src/cli/commands/discover.js";
import { fetchPlaceCandidates } from "../../src/modules/discovery/places.js";
import { applyProfileFilter } from "../../src/modules/discovery/filters.js";
import { createRun, completeRun } from "../../src/storage/runs.js";
import { upsertLeads, loadAllLeads } from "../../src/storage/leads.js";
import { rebuildVocabularyForNiche } from "../../src/storage/vocabulary.js";
import { computeNicheStopWords } from "../../src/modules/enrichment/vocabulary.js";

const RUN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const baseCandidate = {
  placeId: "place-1",
  name: "Salon Bella",
  formattedAddress: "Montevideo",
  rating: 4.5,
  userRatingCount: 10,
  websiteUri: null,
  phone: null,
  businessStatus: "OPERATIONAL",
  raw: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createRun).mockResolvedValue({ id: RUN_ID } as never);
  vi.mocked(completeRun).mockResolvedValue(undefined);
  vi.mocked(upsertLeads).mockResolvedValue({ inserted: [], updated: [] });
  vi.mocked(fetchPlaceCandidates).mockResolvedValue({
    candidates: [baseCandidate],
    textSearchRequestCount: 1,
    requestLog: [],
  } as never);
  vi.mocked(applyProfileFilter).mockReturnValue({
    passed: [baseCandidate],
    rejected: [],
  } as never);
});

describe("discoverCommand — vocabulary rebuild post-hook", () => {
  it("calls loadAllLeads and rebuildVocabularyForNiche after upsertLeads", async () => {
    const allLeads = [
      { id: "l1", niche: "hairdresser", name: "Salon Bella" },
      { id: "l2", niche: "hairdresser", name: "Salon Rosa" },
    ];
    vi.mocked(loadAllLeads).mockResolvedValue(allLeads as never);
    vi.mocked(computeNicheStopWords).mockReturnValue(new Map([["salon", 2]]));
    vi.mocked(rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await discoverCommand({
      niche: "hairdresser",
      location: "Montevideo",
      profile: "a",
      maxResults: 10,
    });

    expect(loadAllLeads).toHaveBeenCalled();
    expect(computeNicheStopWords).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ niche: "hairdresser" })]),
      expect.any(Number),
      expect.any(Number)
    );
    expect(rebuildVocabularyForNiche).toHaveBeenCalledWith(
      "hairdresser",
      new Map([["salon", 2]])
    );
  });

  it("never passes niche='all' to rebuildVocabularyForNiche", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      { id: "l1", niche: "hairdresser", name: "Salon Bella" },
    ] as never);
    vi.mocked(computeNicheStopWords).mockReturnValue(new Map());
    vi.mocked(rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await discoverCommand({
      niche: "hairdresser",
      location: "Montevideo",
      profile: "a",
      maxResults: 10,
    });

    const calls = vi.mocked(rebuildVocabularyForNiche).mock.calls;
    expect(calls.every(([niche]) => niche !== "all")).toBe(true);
  });

  it("does not fail discoverCommand when vocabulary rebuild throws", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      { id: "l1", niche: "hairdresser", name: "Salon Bella" },
    ] as never);
    vi.mocked(computeNicheStopWords).mockReturnValue(new Map([["salon", 2]]));
    vi.mocked(rebuildVocabularyForNiche).mockRejectedValue(new Error("db timeout"));

    await expect(
      discoverCommand({
        niche: "hairdresser",
        location: "Montevideo",
        profile: "a",
        maxResults: 10,
      })
    ).resolves.not.toThrow();

    expect(completeRun).toHaveBeenCalled();
  });

  it("passes only leads belonging to the discovered niche to computeNicheStopWords", async () => {
    const allLeads = [
      { id: "l1", niche: "hairdresser", name: "Salon Bella" },
      { id: "l2", niche: "car_dealer", name: "Zona Motors" },
      { id: "l3", niche: "hairdresser", name: "Salon Rosa" },
    ];
    vi.mocked(loadAllLeads).mockResolvedValue(allLeads as never);
    vi.mocked(computeNicheStopWords).mockReturnValue(new Map());
    vi.mocked(rebuildVocabularyForNiche).mockResolvedValue(undefined);

    await discoverCommand({
      niche: "hairdresser",
      location: "Montevideo",
      profile: "a",
      maxResults: 10,
    });

    const computeCall = vi.mocked(computeNicheStopWords).mock.calls[0];
    expect(computeCall).toBeDefined();
    const leadsArg = computeCall![0];
    expect(leadsArg.every((l: { niche: string }) => l.niche === "hairdresser")).toBe(true);
    expect(leadsArg).toHaveLength(2);
  });
});
