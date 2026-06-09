import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessQueuedDiscoveryJobs, mockConfigChain } = vi.hoisted(() => ({
  mockProcessQueuedDiscoveryJobs: vi.fn(),
  mockConfigChain: {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}));

vi.mock("../../src/modules/pipeline/discovery-jobs.js", () => ({
  processQueuedDiscoveryJobs: mockProcessQueuedDiscoveryJobs,
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: vi.fn(() => mockConfigChain) })),
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { PipelineScheduler, resolveMaxConcurrentRuns } from "../../src/modules/pipeline/scheduler.js";

describe("resolveMaxConcurrentRuns", () => {
  it("defaults to 1 when config is null (backward compatible)", () => {
    expect(resolveMaxConcurrentRuns(null)).toBe(1);
  });

  it("defaults to 1 when the cap is missing", () => {
    expect(resolveMaxConcurrentRuns({} as never)).toBe(1);
  });

  it("uses the configured cap when valid", () => {
    expect(resolveMaxConcurrentRuns({ max_concurrent_runs: 4 } as never)).toBe(4);
  });

  it("ignores non-positive caps and falls back to 1", () => {
    expect(resolveMaxConcurrentRuns({ max_concurrent_runs: 0 } as never)).toBe(1);
  });
});

describe("PipelineScheduler discovery polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessQueuedDiscoveryJobs.mockResolvedValue({
      jobs_processed: 1,
      leads_found: 8,
      leads_new: 3,
    });
  });

  it("falls back to concurrency=1 when config is unavailable", async () => {
    mockConfigChain.single.mockResolvedValue({ data: null, error: { message: "not found" } });
    const scheduler = new PipelineScheduler();
    await (scheduler as unknown as { pollDiscoveryJobs(): Promise<void> }).pollDiscoveryJobs();
    expect(mockProcessQueuedDiscoveryJobs).toHaveBeenCalledWith(1);
  });

  it("uses phases.discovery.max_jobs as concurrency when set", async () => {
    mockConfigChain.single.mockResolvedValue({
      data: {
        cpu_budget: "balanced",
        phases: { discovery: { max_jobs: 4, enabled: true } },
      },
      error: null,
    });
    const scheduler = new PipelineScheduler();
    await (scheduler as unknown as { pollDiscoveryJobs(): Promise<void> }).pollDiscoveryJobs();
    expect(mockProcessQueuedDiscoveryJobs).toHaveBeenCalledWith(4);
  });

  it("derives concurrency from cpu_budget when max_jobs is absent", async () => {
    mockConfigChain.single.mockResolvedValue({
      data: {
        cpu_budget: "aggressive",
        phases: { discovery: { enabled: true } },
      },
      error: null,
    });
    const scheduler = new PipelineScheduler();
    await (scheduler as unknown as { pollDiscoveryJobs(): Promise<void> }).pollDiscoveryJobs();
    expect(mockProcessQueuedDiscoveryJobs).toHaveBeenCalledWith(4);
  });
});
