import { describe, expect, it } from "vitest";
import { shouldRecordCompletion } from "../../src/modules/pipeline/run-executor.js";

describe("shouldRecordCompletion (FD-07)", () => {
  it("avanza last_completed_at solo cuando el run ejecutó y refrescó datos", () => {
    expect(shouldRecordCompletion("completed")).toBe(true);
    expect(shouldRecordCompletion("partial")).toBe(true);
  });

  it("NO avanza ante fallo/aborto (el run no completó OK)", () => {
    expect(shouldRecordCompletion("failed")).toBe(false);
    expect(shouldRecordCompletion("aborted")).toBe(false);
  });
});
