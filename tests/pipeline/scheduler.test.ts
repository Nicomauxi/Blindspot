import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessQueuedDiscoveryJobs } = vi.hoisted(() => ({
  mockProcessQueuedDiscoveryJobs: vi.fn(),
}));

vi.mock("../../src/modules/pipeline/discovery-jobs.js", () => ({
  processQueuedDiscoveryJobs: mockProcessQueuedDiscoveryJobs,
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { PipelineScheduler } from "../../src/modules/pipeline/scheduler.js";

describe("PipelineScheduler discovery polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessQueuedDiscoveryJobs.mockResolvedValue({
      jobs_processed: 1,
      leads_found: 8,
      leads_new: 3,
    });
  });

  it("processes queued discovery jobs through the shared executor", async () => {
    const scheduler = new PipelineScheduler();

    await (scheduler as unknown as { pollDiscoveryJobs(): Promise<void> }).pollDiscoveryJobs();

    expect(mockProcessQueuedDiscoveryJobs).toHaveBeenCalledWith(1);
  });
});
