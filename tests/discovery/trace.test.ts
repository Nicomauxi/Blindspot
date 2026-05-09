import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by Vitest) ────────────────────────────────────────────────

const writtenFiles: Map<string, string> = new Map();

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (p: string, content: string) => { writtenFiles.set(String(p), content); }),
}));

vi.mock("../../src/shared/config.js", () => ({
  getConfig: () => ({ GOOGLE_PLACES_API_KEY: "test-api-key-trace-secret" }),
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../src/storage/runs.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "trace-run-id-abc123" }),
  completeRun: vi.fn().mockResolvedValue(undefined),
  failRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/storage/leads.js", () => ({
  upsertLeads: vi.fn().mockResolvedValue({ inserted: [], updated: [] }),
}));

vi.mock("../../src/modules/discovery/places.js", () => ({
  fetchPlaceCandidates: vi.fn().mockResolvedValue({
    candidates: [],
    textSearchRequestCount: 1,
    requestLog: [],
  }),
  fetchPlaceDetails: vi.fn().mockResolvedValue(null),
  TEXT_SEARCH_FIELDS: "places.id,places.displayName",
  DETAILS_FIELDS: "photos,regularOpeningHours,reviews",
}));

vi.mock("../../src/modules/discovery/config.js", () => ({
  getDiscoveryConfig: () => ({
    social_domains: ["facebook.com", "instagram.com"],
    persist_rejected: true,
  }),
  getProfileConfig: () => ({
    min_rating: 4.3,
    min_reviews: 10,
    max_reviews: 50,
    web_requirement: "social_or_missing",
  }),
}));

// ── Import under test ────────────────────────────────────────────────────────

import { discoverCommand } from "../../src/cli/commands/discover.js";
import { writeFile } from "fs/promises";
import { completeRun } from "../../src/storage/runs.js";
import { upsertLeads } from "../../src/storage/leads.js";
import { fetchPlaceCandidates } from "../../src/modules/discovery/places.js";

const mockWriteFile = vi.mocked(writeFile);
const mockCompleteRun = vi.mocked(completeRun);
const mockUpsertLeads = vi.mocked(upsertLeads);
const mockFetchPlaceCandidates = vi.mocked(fetchPlaceCandidates);

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_ARGS = {
  niche: "peluquería",
  location: "Montevideo Uruguay",
  profile: "a" as const,
  maxResults: 10,
};

function findTraceCall() {
  return mockWriteFile.mock.calls.find(([p]) => String(p).includes("run-trace.json"));
}

function parseTraceJson() {
  const call = findTraceCall();
  expect(call).toBeDefined();
  return JSON.parse(call![1] as string);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("--trace flag", () => {
  beforeEach(() => {
    writtenFiles.clear();
    mockWriteFile.mockClear();
    mockCompleteRun.mockClear();
    mockUpsertLeads.mockClear();
    mockUpsertLeads.mockResolvedValue({ inserted: [], updated: [] });
    mockFetchPlaceCandidates.mockResolvedValue({
      candidates: [],
      textSearchRequestCount: 1,
      requestLog: [],
    });
  });

  it("with --trace: writes run-trace.json under reports/<run_id>/", async () => {
    await discoverCommand({ ...BASE_ARGS, trace: true });
    const call = findTraceCall();
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("trace-run-id-abc123");
    expect(String(call![0])).toContain("run-trace.json");
  });

  it("with --trace: trace JSON has required top-level keys", async () => {
    await discoverCommand({ ...BASE_ARGS, trace: true });
    const json = parseTraceJson();
    expect(json).toHaveProperty("run_id");
    expect(json).toHaveProperty("command", "discover");
    expect(json).toHaveProperty("places_text_search_requests");
    expect(json).toHaveProperty("places_details_requests");
    expect(json).toHaveProperty("candidates");
    expect(json).toHaveProperty("summary");
  });

  it("with --trace: trace JSON does NOT contain API key value", async () => {
    await discoverCommand({ ...BASE_ARGS, trace: true });
    const call = findTraceCall();
    expect(call).toBeDefined();
    expect(String(call![1])).not.toContain("test-api-key-trace-secret");
  });

  it("without --trace: run-trace.json is NOT written", async () => {
    await discoverCommand({ ...BASE_ARGS, trace: false });
    expect(findTraceCall()).toBeUndefined();
  });

  it("with --trace: one Text Search and zero Details costs 0.035 in trace and persisted stats", async () => {
    await discoverCommand({ ...BASE_ARGS, trace: true });

    const json = parseTraceJson();
    expect(json.summary.estimated_cost_usd).toBe(0.035);

    expect(mockCompleteRun).toHaveBeenCalledWith(
      "trace-run-id-abc123",
      expect.objectContaining({
        places_requests: 1,
        estimated_cost_usd: 0.035,
      })
    );
  });

  it("with --trace: Text Search plus Details uses text * 0.035 + details * 0.025 in trace and persisted stats", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce({
      candidates: [
        {
          placeId: "place-details-1",
          name: "Peluquería Test",
          formattedAddress: "Montevideo, Uruguay",
          rating: 4.5,
          userRatingCount: 20,
          websiteUri: null,
          phone: "+59899123456",
          businessStatus: "OPERATIONAL",
          raw: {},
        },
      ],
      textSearchRequestCount: 1,
      requestLog: [],
    });

    await discoverCommand({ ...BASE_ARGS, trace: true });

    const expectedCost = 1 * 0.035 + 1 * 0.025;
    const json = parseTraceJson();
    expect(json.summary.text_search_requests_total).toBe(1);
    expect(json.summary.details_requests_total).toBe(1);
    expect(json.summary.estimated_cost_usd).toBe(expectedCost);

    expect(mockCompleteRun).toHaveBeenCalledWith(
      "trace-run-id-abc123",
      expect.objectContaining({
        places_requests: 2,
        estimated_cost_usd: expectedCost,
      })
    );
  });

  it("passes normalized niche to lead upserts", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce({
      candidates: [
        {
          placeId: "place-niche-1",
          name: "Peluquería Test",
          formattedAddress: "Montevideo, Uruguay",
          rating: 4.5,
          userRatingCount: 20,
          websiteUri: null,
          phone: "+59899123456",
          businessStatus: "OPERATIONAL",
          raw: {},
        },
      ],
      textSearchRequestCount: 1,
      requestLog: [],
    });

    await discoverCommand({ ...BASE_ARGS, niche: "peluquería", trace: false });

    expect(mockUpsertLeads).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ niche: "hairdresser" }),
      ]),
      "trace-run-id-abc123",
      "a",
      expect.any(Function)
    );
  });
});
