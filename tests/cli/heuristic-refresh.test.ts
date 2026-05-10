import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
  loadLeadsByRunId: vi.fn(),
  updateLeadEnrichment: vi.fn(),
}));

vi.mock("../../src/storage/runs.js", () => ({
  getRunById: vi.fn(),
}));

vi.mock("../../src/modules/enrichment/index.js", () => ({
  enrichLead: vi.fn(),
}));

import { heuristicRefreshCommand } from "../../src/cli/commands/heuristic-refresh.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadEnrichment,
} from "../../src/storage/leads.js";
import { getRunById } from "../../src/storage/runs.js";
import { enrichLead } from "../../src/modules/enrichment/index.js";

const mockLoadAll = loadAllLeads as ReturnType<typeof vi.fn>;
const mockLoadByRun = loadLeadsByRunId as ReturnType<typeof vi.fn>;
const mockUpdate = updateLeadEnrichment as ReturnType<typeof vi.fn>;
const mockGetRun = getRunById as ReturnType<typeof vi.fn>;
const mockEnrich = enrichLead as ReturnType<typeof vi.fn>;

const RUN_ID = "94fae3e7-070c-41de-a7c9-3e6875818a83";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    name: "Business",
    address: null,
    rating: null,
    review_count: null,
    website: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRun.mockResolvedValue({ id: RUN_ID });
  mockEnrich.mockResolvedValue({
    digital_footprint: {
      skipped: true,
      reason: "no-website",
      fetched_at: "2026-01-01T00:00:00.000Z",
    },
    tags_to_add: [],
    whatsapp_from_site: null,
    outcome: "skipped-no-website",
    duration_ms: 1,
  });
  mockUpdate.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("heuristicRefreshCommand", () => {
  it("--run selects stale passed leads without a real website", async () => {
    const lead = makeLead({ website: null });
    mockLoadByRun.mockResolvedValue([
      lead,
      makeLead({ id: "real", website: "https://example.com" }),
      makeLead({ id: "rejected", passed_filter: false }),
    ]);

    await heuristicRefreshCommand({
      run: RUN_ID,
      all: false,
      force: false,
      concurrency: 1,
    });

    expect(mockGetRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockLoadByRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEnrich).toHaveBeenCalledWith(lead, {
      forceRefresh: false,
      withHeuristic: true,
    });
  });

  it("--all uses all leads and skips fresh heuristic unless forced", async () => {
    const fresh = makeLead({
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: {
          ran_at: new Date().toISOString(),
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: { website: null, facebook: null, instagram: null, whatsapp: null },
        },
      },
    });
    mockLoadAll.mockResolvedValue([fresh]);

    await heuristicRefreshCommand({
      all: true,
      force: false,
      concurrency: 1,
    });

    expect(mockLoadAll).toHaveBeenCalled();
    expect(mockEnrich).not.toHaveBeenCalled();
  });

  it("--force processes fresh heuristic leads", async () => {
    const fresh = makeLead({
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: {
          ran_at: new Date().toISOString(),
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: { website: null, facebook: null, instagram: null, whatsapp: null },
        },
      },
    });
    mockLoadAll.mockResolvedValue([fresh]);

    await heuristicRefreshCommand({
      all: true,
      force: true,
      concurrency: 1,
    });

    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEnrich).toHaveBeenCalledWith(fresh, {
      forceRefresh: true,
      withHeuristic: true,
    });
  });
});
