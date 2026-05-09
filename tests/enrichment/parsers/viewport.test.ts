import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseViewport } from "../../../src/modules/enrichment/parsers/viewport.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parseViewport", () => {
  it("returns present + content when viewport meta exists", () => {
    const r = parseViewport(load("wordpress-pixel.html"));
    expect(r.present).toBe(true);
    expect(r.content).toBe("width=device-width, initial-scale=1.0");
  });

  it("returns absent on HTML without viewport meta (vintage tiendanube)", () => {
    const r = parseViewport(load("tiendanube-vintage.html"));
    expect(r.present).toBe(false);
    expect(r.content).toBeNull();
  });

  it("returns absent on plain-static fixture", () => {
    const r = parseViewport(load("plain-static.html"));
    expect(r.present).toBe(false);
  });
});
