import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/runs.js", () => ({
  createEnrichmentRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  getRunById: vi.fn(),
}));

vi.mock("../../src/storage/leads.js", () => ({
  loadLeadsByRunId: vi.fn(),
  loadLeadsBySource: vi.fn(),
  loadAllPassedLeads: vi.fn(),
  updateLeadEnrichment: vi.fn(),
}));

vi.mock("../../src/storage/vocabulary.js", () => ({
  loadFilterWordsForNiche: vi.fn(),
}));

vi.mock("../../src/storage/system-lists.js", () => ({
  loadAllRuntime: vi.fn(),
  detectAndSeedEmailProviders: vi.fn(),
  retroactiveEmailCleanup: vi.fn(),
  detectAndSeedHeuristicDomains: vi.fn(),
}));

vi.mock("../../src/modules/enrichment/index.js", () => ({
  enrichLead: vi.fn(),
}));

import { enrichCommand } from "../../src/cli/commands/enrich.js";
import { getRunById, createEnrichmentRun, completeRun } from "../../src/storage/runs.js";
import { loadLeadsByRunId, loadLeadsBySource, loadAllPassedLeads, updateLeadEnrichment } from "../../src/storage/leads.js";
import { loadFilterWordsForNiche } from "../../src/storage/vocabulary.js";
import { detectAndSeedEmailProviders, loadAllRuntime, retroactiveEmailCleanup, detectAndSeedHeuristicDomains } from "../../src/storage/system-lists.js";
import { enrichLead } from "../../src/modules/enrichment/index.js";

const RUN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ENRICH_RUN_ID = "11111111-2222-3333-4444-555555555555";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    name: "Salon Bella",
    niche: "hairdresser",
    address: null,
    rating: null,
    review_count: null,
    website: "https://example.com",
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: RUN_ID,
    last_seen_run_id: RUN_ID,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseEnrichResult = {
  digital_footprint: { skipped: true, reason: "no-website", fetched_at: "2026-01-01T00:00:00.000Z" },
  tags_to_add: [],
  whatsapp_from_site: null,
  outcome: "skipped-no-website" as const,
  duration_ms: 10,
};

const baseRuntime = {
  lists: {
    blockedEmailDomains: new Set<string>(),
    freeEmailDomains: new Set<string>(),
    blockedEmailPrefixes: [] as string[],
    stopWords: new Set<string>(),
    vocabularyStopWords: new Set<string>(),
    geographicStopWords: new Set<string>(),
    properNounStopWords: new Set<string>(),
    socialDomains: [] as string[],
    platformHosts: {},
    blockedInstagramHosts: [] as string[],
    foreignTlds: new Set<string>(),
    foreignGeoTerms: [] as string[],
    foreignPhonePrefixes: [] as string[],
  },
  patterns: {
    booking: [] as string[],
    reservation: [] as string[],
    delivery: [] as string[],
    classBooking: [] as string[],
    appStore: [] as { pattern: string; matchType: string }[],
    menuKeywords: [] as string[],
    catalogKeywords: [] as string[],
    chatWidgets: [] as string[],
    ecommercePlatforms: [] as string[],
  },
  mappings: {
    descriptorWords: new Map<string, string>(),
    nicheAliases: [] as { niche: string; term: string; matchType: string }[],
    directoryCategories: new Map<string, string | null>(),
    nicheStopWords: new Map<string, Set<string>>(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRunById).mockResolvedValue({ id: RUN_ID } as never);
  vi.mocked(createEnrichmentRun).mockResolvedValue({ id: ENRICH_RUN_ID } as never);
  vi.mocked(completeRun).mockResolvedValue(undefined);
  vi.mocked(updateLeadEnrichment).mockResolvedValue(undefined);
  vi.mocked(enrichLead).mockResolvedValue(baseEnrichResult);
  vi.mocked(loadFilterWordsForNiche).mockResolvedValue(new Set());
  vi.mocked(loadAllRuntime).mockResolvedValue(baseRuntime);
  vi.mocked(detectAndSeedEmailProviders).mockResolvedValue(0);
  vi.mocked(retroactiveEmailCleanup).mockResolvedValue(0);
  vi.mocked(detectAndSeedHeuristicDomains).mockResolvedValue(0);
  vi.mocked(loadLeadsBySource).mockResolvedValue([]);
  vi.mocked(loadAllPassedLeads).mockResolvedValue([]);
});

describe("enrichCommand — vocabulary loading", () => {
  it("calls loadFilterWordsForNiche for each unique niche in the run's leads", async () => {
    const leads = [
      makeLead({ id: "l1", niche: "hairdresser" }),
      makeLead({ id: "l2", niche: "hairdresser" }),
      makeLead({ id: "l3", niche: "car_dealer" }),
    ];
    vi.mocked(loadLeadsByRunId).mockResolvedValue(leads);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(loadFilterWordsForNiche).toHaveBeenCalledTimes(2);
    expect(loadFilterWordsForNiche).toHaveBeenCalledWith("hairdresser");
    expect(loadFilterWordsForNiche).toHaveBeenCalledWith("car_dealer");
  });

  it("does not call loadFilterWordsForNiche for leads with null niche", async () => {
    const leads = [
      makeLead({ id: "l1", niche: null }),
      makeLead({ id: "l2", niche: null }),
    ];
    vi.mocked(loadLeadsByRunId).mockResolvedValue(leads);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(loadFilterWordsForNiche).not.toHaveBeenCalled();
  });

  it("passes extraStopWords to enrichLead when vocabulary is non-empty", async () => {
    const stopWords = new Set(["salon", "centro"]);
    vi.mocked(loadFilterWordsForNiche).mockResolvedValue(stopWords);
    vi.mocked(loadLeadsByRunId).mockResolvedValue([makeLead({ niche: "hairdresser" })]);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(enrichLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ extraStopWords: stopWords }),
      undefined,
      expect.anything()
    );
  });

  it("passes runtime-derived context to enrichLead", async () => {
    vi.mocked(loadAllRuntime).mockResolvedValue({
      ...baseRuntime,
      lists: {
        ...baseRuntime.lists,
        blockedEmailDomains: new Set(["blocked.test"]),
        freeEmailDomains: new Set(["gmail.com"]),
        blockedEmailPrefixes: ["noreply"],
        stopWords: new Set(["de"]),
        foreignTlds: new Set(["mx"]),
        foreignGeoTerms: ["mexico"],
        foreignPhonePrefixes: ["+52"],
      },
      patterns: {
        ...baseRuntime.patterns,
        reservation: ["reservando.uy"],
        delivery: ["pedidosya.com"],
        classBooking: ["mindbody.io"],
        appStore: [{ pattern: "apps.apple.com", matchType: "domain" }],
        menuKeywords: ["ver menu"],
        catalogKeywords: ["stock"],
        chatWidgets: ["tawk.to"],
      },
      mappings: {
        ...baseRuntime.mappings,
        descriptorWords: new Map([["peluqueria", "pelu"]]),
        nicheStopWords: new Map([
          ["all", new Set(["centro"])],
          ["hairdresser", new Set(["barbero"])],
        ]),
      },
    });
    vi.mocked(loadLeadsByRunId).mockResolvedValue([makeLead({ niche: "hairdresser" })]);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(enrichLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        emailCtx: expect.objectContaining({
          blockedDomains: new Set(["blocked.test"]),
          freeDomains: new Set(["gmail.com"]),
          blockedPrefixes: ["noreply"],
        }),
        geoCtx: expect.objectContaining({
          foreignTlds: new Set(["mx"]),
          foreignGeoTerms: ["mexico"],
          foreignPhonePrefixes: ["+52"],
        }),
        operationalCtx: expect.objectContaining({
          reservationPlatforms: ["reservando.uy"],
          deliveryPlatforms: ["pedidosya.com"],
          classBookingPlatforms: ["mindbody.io"],
          appStorePlatforms: ["apps.apple.com"],
          menuKeywords: ["ver menu"],
          catalogKeywords: ["stock"],
          chatWidgetPatterns: ["tawk.to"],
        }),
        heuristicListsCtx: expect.objectContaining({
          stopWords: new Set(["de"]),
          nicheStopWords: new Set(["centro", "barbero"]),
          descriptorWords: new Map([["peluqueria", "pelu"]]),
        }),
      })
    );
  });

  it("does not include extraStopWords key when vocabulary is empty", async () => {
    vi.mocked(loadFilterWordsForNiche).mockResolvedValue(new Set());
    vi.mocked(loadLeadsByRunId).mockResolvedValue([makeLead({ niche: "hairdresser" })]);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    const callArg = vi.mocked(enrichLead).mock.calls[0]?.[1];
    expect(callArg).not.toHaveProperty("extraStopWords");
  });

  it("does not include extraStopWords when lead has null niche", async () => {
    vi.mocked(loadLeadsByRunId).mockResolvedValue([makeLead({ niche: null })]);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    const callArg = vi.mocked(enrichLead).mock.calls[0]?.[1];
    expect(callArg).not.toHaveProperty("extraStopWords");
  });

  it("continues enriching even if vocabulary load throws (graceful degradation)", async () => {
    vi.mocked(loadFilterWordsForNiche).mockRejectedValue(new Error("db connection failed"));
    vi.mocked(loadLeadsByRunId).mockResolvedValue([makeLead({ niche: "hairdresser" })]);

    await expect(
      enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 })
    ).resolves.not.toThrow();

    expect(enrichLead).toHaveBeenCalledTimes(1);
  });
});

describe("enrichCommand — mode routing", () => {
  it("--run: loads passed leads from run by default", async () => {
    vi.mocked(loadLeadsByRunId).mockResolvedValue([]);

    await enrichCommand({ run: RUN_ID, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(loadLeadsByRunId).toHaveBeenCalledWith(RUN_ID, { passedOnly: true });
    expect(loadLeadsBySource).not.toHaveBeenCalled();
    expect(loadAllPassedLeads).not.toHaveBeenCalled();
  });

  it("--source: loads passed leads by source, not by run", async () => {
    vi.mocked(loadLeadsBySource).mockResolvedValue([]);

    await enrichCommand({ source: "mintur", forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(loadLeadsBySource).toHaveBeenCalledWith("mintur", { passedOnly: true });
    expect(loadLeadsByRunId).not.toHaveBeenCalled();
    expect(loadAllPassedLeads).not.toHaveBeenCalled();
  });

  it("--all: loads all passed leads from DB", async () => {
    vi.mocked(loadAllPassedLeads).mockResolvedValue([]);

    await enrichCommand({ all: true, forceRefresh: false, withHeuristic: false, concurrency: 1 });

    expect(loadAllPassedLeads).toHaveBeenCalled();
    expect(loadLeadsByRunId).not.toHaveBeenCalled();
    expect(loadLeadsBySource).not.toHaveBeenCalled();
  });
});
