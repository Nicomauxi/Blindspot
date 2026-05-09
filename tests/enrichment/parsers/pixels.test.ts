import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePixels } from "../../../src/modules/enrichment/parsers/pixels.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parsePixels", () => {
  it("detects Meta Pixel + extracts numeric ID from fbq init", () => {
    const html = load("wordpress-pixel.html");
    const r = parsePixels(html);
    expect(r.meta_pixel.present).toBe(true);
    expect(r.meta_pixel.id).toBe("1234567890123456");
  });

  it("detects GA4 + extracts measurement ID", () => {
    const html = load("shopify-ga4.html");
    const r = parsePixels(html);
    expect(r.ga4.present).toBe(true);
    expect(r.ga4.id).toBe("G-ABC123XYZ9");
  });

  it("detects GTM + extracts container ID", () => {
    const html = load("squarespace-clean.html");
    const r = parsePixels(html);
    expect(r.gtm.present).toBe(true);
    expect(r.gtm.id).toBe("GTM-ABC1234");
  });

  it("does NOT mark Meta Pixel present on HTML without fbq", () => {
    const r = parsePixels("<html><body>nothing</body></html>");
    expect(r.meta_pixel.present).toBe(false);
    expect(r.meta_pixel.id).toBeNull();
  });

  it("does NOT mark GA4 present on HTML without gtag config", () => {
    const r = parsePixels(load("plain-static.html"));
    expect(r.ga4.present).toBe(false);
    expect(r.ga_universal.present).toBe(false);
    expect(r.gtm.present).toBe(false);
    expect(r.meta_pixel.present).toBe(false);
  });

  it("detects GA Universal via UA-XXX-Y id in HTML", () => {
    const html = `<script>ga('create', 'UA-12345-6', 'auto');</script>`;
    const r = parsePixels(html);
    expect(r.ga_universal.present).toBe(true);
    expect(r.ga_universal.id).toBe("UA-12345-6");
  });

  it("detects GA Universal via analytics.js script tag", () => {
    const html = `<script src="https://google-analytics.com/analytics.js"></script>`;
    const r = parsePixels(html);
    expect(r.ga_universal.present).toBe(true);
  });

  it("detects GA4 via gtag/js URL only when explicit (no config call)", () => {
    const html = `<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ987"></script>`;
    const r = parsePixels(html);
    expect(r.ga4.present).toBe(true);
    expect(r.ga4.id).toBe("G-XYZ987");
  });

  it("detects Meta Pixel via fbevents.js URL when fbq init is missing", () => {
    const html = `<script src="https://connect.facebook.net/en_US/fbevents.js"></script>`;
    const r = parsePixels(html);
    expect(r.meta_pixel.present).toBe(true);
    expect(r.meta_pixel.id).toBeNull();
  });

  it("returns all-false on completely empty HTML", () => {
    const r = parsePixels("");
    expect(r.meta_pixel.present).toBe(false);
    expect(r.ga4.present).toBe(false);
    expect(r.ga_universal.present).toBe(false);
    expect(r.gtm.present).toBe(false);
  });
});
