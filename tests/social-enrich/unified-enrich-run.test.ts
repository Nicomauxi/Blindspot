import { describe, expect, it } from "vitest";
import { resolveExhaustedAction } from "../../src/modules/social-enrich/unified-enrich-run.js";

describe("resolveExhaustedAction (FD-05)", () => {
  it("cae a SearXNG SOLO cuando las keys se agotaron de verdad", () => {
    expect(resolveExhaustedAction("all_keys_exhausted", true)).toBe("fallback");
  });

  it("NO cae a SearXNG cuando paramos por tope de costo (--max-queries)", () => {
    expect(resolveExhaustedAction("budget", true)).toBe("no_match");
  });

  it("respeta --no-searxng-fallback aun con keys agotadas", () => {
    expect(resolveExhaustedAction("all_keys_exhausted", false)).toBe("no_match");
  });

  it("sin razón de corte → no_match", () => {
    expect(resolveExhaustedAction(null, true)).toBe("no_match");
  });
});
