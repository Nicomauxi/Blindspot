import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { recordPipelineError } from "../../src/storage/pipeline-errors.js";

describe("recordPipelineError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a pipeline error with nullable fields normalized", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "err-1",
        phase: "enrich",
        source: null,
        lead_id: null,
        recovered: false,
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));

    mockFrom.mockReturnValue({ insert });

    const row = await recordPipelineError({
      run_id: "run-1",
      phase: "enrich",
      error_type: "timeout",
      message: "Lead timed out",
    });

    expect(mockFrom).toHaveBeenCalledWith("pipeline_errors");
    expect(insert).toHaveBeenCalledWith({
      run_id: "run-1",
      phase: "enrich",
      source: null,
      lead_id: null,
      error_type: "timeout",
      message: "Lead timed out",
      stack: null,
      recovered: false,
    });
    expect(select).toHaveBeenCalled();
    expect(single).toHaveBeenCalled();
    expect(row.id).toBe("err-1");
  });

  it("preserves explicit recovered/source/lead_id values", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "err-2",
        phase: "refresh",
        source: "google_places",
        lead_id: "lead-1",
        recovered: true,
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));

    mockFrom.mockReturnValue({ insert });

    await recordPipelineError({
      run_id: "run-2",
      phase: "refresh",
      source: "google_places",
      lead_id: "lead-1",
      error_type: "http_429",
      message: "Rate limited",
      stack: "stack trace",
      recovered: true,
    });

    expect(insert).toHaveBeenCalledWith({
      run_id: "run-2",
      phase: "refresh",
      source: "google_places",
      lead_id: "lead-1",
      error_type: "http_429",
      message: "Rate limited",
      stack: "stack trace",
      recovered: true,
    });
    expect(select).toHaveBeenCalled();
    expect(single).toHaveBeenCalled();
  });

  it("throws when the insert fails", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insert failed" },
    });
    mockFrom.mockReturnValue({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single })),
      })),
    });

    await expect(
      recordPipelineError({
        phase: "score",
        error_type: "db_error",
        message: "Could not write",
      })
    ).rejects.toThrow("Failed to insert pipeline error: insert failed");
  });
});
