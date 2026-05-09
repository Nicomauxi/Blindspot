import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSocialLinks } from "../../../src/modules/enrichment/parsers/social-links.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parseSocialLinks", () => {
  it("detects Instagram link only when present", () => {
    const r = parseSocialLinks(load("wordpress-pixel.html"));
    expect(r.instagram).toBe("https://www.instagram.com/salonvintage");
    expect(r.facebook).toBeNull();
    expect(r.tiktok).toBeNull();
    expect(r.count).toBe(1);
  });

  it("detects all three networks when present", () => {
    const html = `
      <html><body>
        <a href="https://www.facebook.com/x">FB</a>
        <a href="https://www.instagram.com/x">IG</a>
        <a href="https://www.tiktok.com/@x">TT</a>
      </body></html>`;
    const r = parseSocialLinks(html);
    expect(r.facebook).toContain("facebook.com/x");
    expect(r.instagram).toContain("instagram.com/x");
    expect(r.tiktok).toContain("tiktok.com/@x");
    expect(r.count).toBe(3);
  });

  it("returns nulls and count=0 on plain-static fixture", () => {
    const r = parseSocialLinks(load("plain-static.html"));
    expect(r.facebook).toBeNull();
    expect(r.instagram).toBeNull();
    expect(r.tiktok).toBeNull();
    expect(r.count).toBe(0);
  });
});
