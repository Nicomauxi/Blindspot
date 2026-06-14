import { describe, expect, it } from "vitest";
import { isWebsiteGenuinelyMissing } from "../../src/modules/enrichment/fetch-error.js";
import { cleanupMergedTagsForEnrichment } from "../../src/storage/leads.js";
import type { DigitalFootprint } from "../../src/shared/types.js";

describe("site-unreachable: clasificación de fetch_error", () => {
  it("solo 404/410/invalid-domain son 'sitio genuinamente ausente'", () => {
    expect(isWebsiteGenuinelyMissing("http-404")).toBe(true);
    expect(isWebsiteGenuinelyMissing("http-410")).toBe(true);
    expect(isWebsiteGenuinelyMissing("invalid-domain")).toBe(true);
  });

  it("403 (bot-block), timeouts, 5xx, 429, network y non-html NO son ausencia", () => {
    expect(isWebsiteGenuinelyMissing("http-403")).toBe(false);
    expect(isWebsiteGenuinelyMissing("http-429")).toBe(false);
    expect(isWebsiteGenuinelyMissing("http-500")).toBe(false);
    expect(isWebsiteGenuinelyMissing("http-503")).toBe(false);
    expect(isWebsiteGenuinelyMissing("network: fetch failed")).toBe(false);
    expect(isWebsiteGenuinelyMissing("network: The operation was aborted due to timeout")).toBe(false);
    expect(isWebsiteGenuinelyMissing("non-html-content")).toBe(false);
    expect(isWebsiteGenuinelyMissing(null)).toBe(false);
  });
});

describe("cleanupMergedTagsForEnrichment: site-unreachable stale", () => {
  it("limpia site-unreachable cuando el re-fetch fue exitoso (sin fetch_error)", () => {
    const fp = { fetched_at: "2026-06-12T00:00:00Z" } as unknown as DigitalFootprint;
    const tags = cleanupMergedTagsForEnrichment(["site-unreachable", "profile:d"], fp);
    expect(tags).not.toContain("site-unreachable");
    expect(tags).toContain("profile:d");
  });

  it("limpia site-unreachable cuando el error es transitorio (403 bot-block)", () => {
    const fp = { fetch_error: "http-403", fetched_at: "2026-06-12T00:00:00Z" } as unknown as DigitalFootprint;
    const tags = cleanupMergedTagsForEnrichment(["site-unreachable"], fp);
    expect(tags).not.toContain("site-unreachable");
  });

  it("MANTIENE site-unreachable cuando el sitio está genuinamente ausente (404)", () => {
    const fp = { fetch_error: "http-404", fetched_at: "2026-06-12T00:00:00Z" } as unknown as DigitalFootprint;
    const tags = cleanupMergedTagsForEnrichment(["site-unreachable"], fp);
    expect(tags).toContain("site-unreachable");
  });
});
