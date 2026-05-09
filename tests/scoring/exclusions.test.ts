import { describe, it, expect } from "vitest";
import { applyMutualExclusions } from "../../src/modules/scoring/exclusions.js";
import type { EvaluatedRule } from "../../src/modules/scoring/types.js";

function rule(name: string, weight: number): EvaluatedRule {
  return { name, weight, matched_value: null };
}

describe("applyMutualExclusions", () => {
  it("returns original list unchanged when no groups are defined", () => {
    const rules = [rule("a", 10), rule("b", 20)];
    expect(applyMutualExclusions(rules, [])).toEqual(rules);
  });

  it("returns list unchanged when no group member matched", () => {
    const rules = [rule("x", 10)];
    const groups = [["a", "b"]];
    expect(applyMutualExclusions(rules, groups)).toEqual(rules);
  });

  it("returns list unchanged when exactly one group member matched", () => {
    const rules = [rule("a", 10), rule("x", 5)];
    const groups = [["a", "b"]];
    expect(applyMutualExclusions(rules, groups)).toEqual(rules);
  });

  it("keeps only highest-weight rule when two group members match", () => {
    const rules = [rule("a", 15), rule("b", 25), rule("extra", 5)];
    const groups = [["a", "b"]];
    const result = applyMutualExclusions(rules, groups);
    const names = result.map((r) => r.name);
    expect(names).not.toContain("a");
    expect(names).toContain("b");
    expect(names).toContain("extra");
  });

  it("keeps first-in-group-order on weight tie", () => {
    // Group order: [a, b, c] — both b and c have same weight; a is in group but not matched
    const rules = [rule("b", 20), rule("c", 20)];
    const groups = [["a", "b", "c"]];
    const result = applyMutualExclusions(rules, groups);
    expect(result.map((r) => r.name)).toEqual(["b"]); // b is before c in YAML group order
  });

  it("handles two independent groups independently", () => {
    // Group 1: [r1, r2] — both match, r1 has higher weight
    // Group 2: [r3, r4] — both match, r4 has higher weight
    const rules = [rule("r1", 30), rule("r2", 20), rule("r3", 10), rule("r4", 25)];
    const groups = [["r1", "r2"], ["r3", "r4"]];
    const result = applyMutualExclusions(rules, groups);
    const names = result.map((r) => r.name);
    expect(names).toContain("r1");
    expect(names).not.toContain("r2");
    expect(names).not.toContain("r3");
    expect(names).toContain("r4");
  });

  it("keeps no_website (35) over fb_only (25) — real YAML group scenario", () => {
    const rules = [rule("no_website", 35), rule("fb_only", 25)];
    const groups = [["no_website", "fb_only", "ig_only", "social_link_only"]];
    const result = applyMutualExclusions(rules, groups);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("no_website");
  });
});
