import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { insertDiscoveryJob, updateDiscoveryJobStatus } from "../../src/storage/discovery-jobs.js";

function buildInsertChain(result: { data: unknown; error: unknown }) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

function buildUpdateChain(result: { error: unknown }) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(result),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe("insertDiscoveryJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts job and returns data", async () => {
    const row = { id: "abc", source: "yelu", location: "Montevideo", status: "queued" };
    buildInsertChain({ data: row, error: null });
    const result = await insertDiscoveryJob({ source: "yelu", location: "Montevideo" });
    expect(result.id).toBe("abc");
    expect(result.status).toBe("queued");
  });

  it("throws on DB error", async () => {
    buildInsertChain({ data: null, error: { message: "insert failed" } });
    await expect(insertDiscoveryJob({ source: "yelu", location: "Montevideo" })).rejects.toThrow("insert failed");
  });
});

describe("updateDiscoveryJobStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates status to running", async () => {
    const chain = buildUpdateChain({ error: null });
    await updateDiscoveryJobStatus("job-1", "running");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", started_at: expect.any(String) })
    );
  });

  it("updates status to completed with counts", async () => {
    const chain = buildUpdateChain({ error: null });
    await updateDiscoveryJobStatus("job-1", "completed", { leads_found: 30, leads_new: 5 });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", leads_found: 30, leads_new: 5 })
    );
  });

  it("updates status to failed with error message", async () => {
    const chain = buildUpdateChain({ error: null });
    await updateDiscoveryJobStatus("job-1", "failed", { error_message: "timeout" });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: "timeout" })
    );
  });

  it("throws on DB error", async () => {
    buildUpdateChain({ error: { message: "update failed" } });
    await expect(updateDiscoveryJobStatus("job-1", "completed")).rejects.toThrow("update failed");
  });
});
