import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { insertDiscoveryJob, updateDiscoveryJobStatus } from "../../src/storage/discovery-jobs.js";

function buildInsertSelectSingle(result: { data: unknown; error: unknown }) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function buildBatchRefreshChains() {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({
      data: [
        { status: "queued", started_at: null, completed_at: null, estimated_cost_usd: 1.2, actual_cost_usd: 0 },
      ],
      error: null,
    }),
  };
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
  return { selectChain, updateChain };
}

describe("discovery job storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a job and returns data", async () => {
    const insertChain = buildInsertSelectSingle({
      data: { id: "job-1", source: "yelu", location: "Montevideo", status: "queued", batch_id: null },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "discovery_jobs") return insertChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await insertDiscoveryJob({ source: "yelu", location: "Montevideo" });
    expect(result.id).toBe("job-1");
    expect(insertChain.insert).toHaveBeenCalled();
  });

  it("refreshes batch aggregate when inserting a child job", async () => {
    const insertChain = buildInsertSelectSingle({
      data: { id: "job-1", source: "yelu", location: "Montevideo", status: "queued", batch_id: "batch-1" },
      error: null,
    });
    const { selectChain, updateChain } = buildBatchRefreshChains();

    mockFrom.mockImplementation((table: string) => {
      if (table === "discovery_jobs") {
        return mockFrom.mock.calls.filter(([name]) => name === "discovery_jobs").length === 1 ? insertChain : selectChain;
      }
      if (table === "discovery_job_batches") return updateChain;
      throw new Error(`unexpected table ${table}`);
    });

    await insertDiscoveryJob({ source: "yelu", location: "Montevideo", batch_id: "batch-1" });
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "queued", estimated_cost_usd: 1.2 }));
  });

  it("updates completed jobs with run and cost metadata", async () => {
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { batch_id: "batch-1" }, error: null }),
    };
    const { selectChain, updateChain: batchUpdateChain } = buildBatchRefreshChains();

    mockFrom.mockImplementation((table: string) => {
      if (table === "discovery_jobs") {
        return mockFrom.mock.calls.filter(([name]) => name === "discovery_jobs").length === 1 ? updateChain : selectChain;
      }
      if (table === "discovery_job_batches") return batchUpdateChain;
      throw new Error(`unexpected table ${table}`);
    });

    await updateDiscoveryJobStatus("job-1", "completed", {
      leads_found: 20,
      leads_new: 5,
      linked_run_id: "run-1",
      actual_cost_usd: 1.4,
      estimated_cost_usd: 1.6,
    });

    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      leads_found: 20,
      leads_new: 5,
      linked_run_id: "run-1",
      actual_cost_usd: 1.4,
      estimated_cost_usd: 1.6,
    }));
    expect(batchUpdateChain.update).toHaveBeenCalled();
  });
});
