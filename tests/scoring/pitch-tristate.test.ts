import { describe, expect, it } from "vitest";
import { inferredTriState } from "../../src/modules/scoring/state.js";
import type { InferredState } from "../../src/shared/types.js";

describe("N1.6/N09: matching tri-estado de pitch hooks", () => {
  it("campo ausente o con confidence 0 → unknown (no afirma ausencia)", () => {
    expect(inferredTriState(null, "has_delivery")).toBe("unknown");
    const state = {
      has_delivery: { value: false, confidence: 0, via: [] },
    } as unknown as InferredState;
    expect(inferredTriState(state, "has_delivery")).toBe("unknown");
  });

  it("ausencia VERIFICADA (confidence > 0) → false; presencia → true", () => {
    const state = {
      has_delivery: { value: false, confidence: 0.8, via: ["html"] },
      has_pos: { value: true, confidence: 0.9, via: ["html"] },
    } as unknown as InferredState;
    expect(inferredTriState(state, "has_delivery")).toBe(false);
    expect(inferredTriState(state, "has_pos")).toBe(true);
  });
});
