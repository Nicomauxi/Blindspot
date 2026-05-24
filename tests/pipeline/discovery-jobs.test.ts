import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listChain: {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
  executeExternalDiscovery: vi.fn(),
  createRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  updateDiscoveryJobStatus: vi.fn(),
  updateDiscoveryJobEnrichmentStatus: vi.fn(),
  enrichCommand: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({
    from: vi.fn(() => mocks.listChain),
  })),
}));

vi.mock("../../src/cli/commands/discover-external.js", () => ({
  executeExternalDiscovery: mocks.executeExternalDiscovery,
}));

vi.mock("../../src/storage/runs.js", () => ({
  createRun: mocks.createRun,
  completeRun: mocks.completeRun,
  failRun: mocks.failRun,
}));

vi.mock("../../src/storage/discovery-jobs.js", () => ({
  updateDiscoveryJobStatus: mocks.updateDiscoveryJobStatus,
  updateDiscoveryJobEnrichmentStatus: mocks.updateDiscoveryJobEnrichmentStatus,
}));

vi.mock("../../src/cli/commands/enrich.js", () => ({
  enrichCommand: mocks.enrichCommand,
}));

vi.mock("../../src/modules/pipeline/google-places-discovery-job.js", () => ({
  executeGooglePlacesDiscoveryJob: vi.fn(),
}));

import { processQueuedDiscoveryJobs } from "../../src/modules/pipeline/discovery-jobs.js";

describe("processQueuedDiscoveryJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listChain.limit.mockResolvedValue({
      data: [
        {
          id: "job-1",
          source: "yelu",
          location: "Montevideo",
          niche: "restaurant",
          profile: null,
          concurrency: null,
          max_results: 200,
          cost_cap_usd: null,
          cpu_budget: "balanced",
          enrich_after_discovery: true,
        },
      ],
      error: null,
    });
    mocks.executeExternalDiscovery.mockResolvedValue({ fetched: 12, inserted: 4, corroborated: 2 });
    mocks.createRun.mockResolvedValue({ id: "discover-run-1" });
    mocks.completeRun.mockResolvedValue(undefined);
    mocks.failRun.mockResolvedValue(undefined);
    mocks.updateDiscoveryJobStatus.mockResolvedValue(undefined);
    mocks.updateDiscoveryJobEnrichmentStatus.mockResolvedValue(undefined);
    mocks.enrichCommand.mockResolvedValue({ runId: "enrich-run-1", stats: { command: "enrich" } });
  });

  it("chains enrichment after a queued discovery job when enabled", async () => {
    const result = await processQueuedDiscoveryJobs(1);

    expect(result).toEqual({ jobs_processed: 1, leads_found: 12, leads_new: 4 });
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({
      location: "Montevideo",
      niche: "restaurant",
      config: expect.objectContaining({ enrich_after_discovery: true, source: "yelu" }),
    }));
    expect(mocks.updateDiscoveryJobStatus).toHaveBeenCalledWith("job-1", "completed", expect.objectContaining({ linked_run_id: "discover-run-1" }));
    expect(mocks.updateDiscoveryJobEnrichmentStatus).toHaveBeenNthCalledWith(1, "job-1", "running");
    expect(mocks.updateDiscoveryJobEnrichmentStatus).toHaveBeenNthCalledWith(2, "job-1", "completed", { linked_enrich_run_id: "enrich-run-1" });
    expect(mocks.enrichCommand).toHaveBeenCalledWith(expect.objectContaining({ run: "discover-run-1", withHeuristic: true }));
  });

  it("fetches exactly concurrency jobs from the queue", async () => {
    await processQueuedDiscoveryJobs(3);
    expect(mocks.listChain.limit).toHaveBeenCalledWith(3);
  });

  it("processes multiple jobs concurrently and aggregates results", async () => {
    mocks.listChain.limit.mockResolvedValue({
      data: [
        { id: "job-1", source: "yelu", location: "Montevideo", niche: "restaurant", profile: null, concurrency: null, max_results: 100, cost_cap_usd: null, cpu_budget: null, enrich_after_discovery: false },
        { id: "job-2", source: "yelu", location: "Canelones", niche: "hotel", profile: null, concurrency: null, max_results: 100, cost_cap_usd: null, cpu_budget: null, enrich_after_discovery: false },
      ],
      error: null,
    });
    mocks.createRun
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });
    mocks.executeExternalDiscovery
      .mockResolvedValueOnce({ fetched: 10, inserted: 3, corroborated: 0 })
      .mockResolvedValueOnce({ fetched: 8, inserted: 2, corroborated: 0 });

    const result = await processQueuedDiscoveryJobs(2);

    expect(result.jobs_processed).toBe(2);
    expect(result.leads_found).toBe(18);
    expect(result.leads_new).toBe(5);
    expect(mocks.updateDiscoveryJobStatus).toHaveBeenCalledWith("job-1", "running");
    expect(mocks.updateDiscoveryJobStatus).toHaveBeenCalledWith("job-2", "running");
  });

  it("returns empty summary when no jobs are queued", async () => {
    mocks.listChain.limit.mockResolvedValue({ data: [], error: null });
    const result = await processQueuedDiscoveryJobs(4);
    expect(result).toEqual({ jobs_processed: 0, leads_found: 0, leads_new: 0 });
  });
});
