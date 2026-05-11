import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizeUruguayMobile,
  parseWhatsapp,
} from "../../../src/modules/enrichment/parsers/whatsapp.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parseWhatsapp", () => {
  it("detects wa.me link and extracts number", () => {
    const r = parseWhatsapp(load("wordpress-pixel.html"));
    expect(r.present).toBe(true);
    expect(r.source).toBe("link");
    expect(r.numbers).toContain("+59899123456");
  });

  it("detects api.whatsapp.com/send link and extracts number from query", () => {
    const r = parseWhatsapp(load("wix-with-whatsapp.html"));
    expect(r.present).toBe(true);
    expect(r.source).toBe("link");
    expect(r.numbers).toContain("+59899765432");
  });

  it("detects button via class heuristic when no link", () => {
    const html = `<html><body><div class="wa-button">Chat</div></body></html>`;
    const r = parseWhatsapp(html);
    expect(r.present).toBe(true);
    expect(r.source).toBe("button-heuristic");
    expect(r.numbers).toEqual([]);
  });

  it("returns absent when nothing matches", () => {
    const r = parseWhatsapp(load("plain-static.html"));
    expect(r.present).toBe(false);
    expect(r.source).toBeNull();
    expect(r.numbers).toEqual([]);
  });
});

describe("normalizeUruguayMobile", () => {
  it("rejects invalid Uruguay mobile candidates", () => {
    expect(normalizeUruguayMobile("00059899999999")).toBeNull();
    expect(normalizeUruguayMobile("099 123 4567")).toBeNull();
    expect(normalizeUruguayMobile("099 123 456")).toBeNull();
    expect(normalizeUruguayMobile("099 123 45678")).toBeNull();
    expect(normalizeUruguayMobile("091 234 567")).toBeNull();
  });

  it("normalizes valid Uruguay mobile candidates to E.164", () => {
    expect(normalizeUruguayMobile("098 892 879")).toBe("+59898892879");
    expect(normalizeUruguayMobile("+598 98 892 879")).toBe("+59898892879");
    expect(normalizeUruguayMobile("0059899123456")).toBe("+59899123456");
    expect(normalizeUruguayMobile("59895123456")).toBe("+59895123456");
  });
});
