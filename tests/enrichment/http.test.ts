import { describe, expect, it } from "vitest";
import { USER_AGENT } from "../../src/modules/enrichment/http.js";

describe("USER_AGENT", () => {
  it("is not empty", () => {
    expect(USER_AGENT.length).toBeGreaterThan(0);
  });

  it("does not contain the yourorg placeholder", () => {
    expect(USER_AGENT).not.toContain("yourorg");
  });
});
