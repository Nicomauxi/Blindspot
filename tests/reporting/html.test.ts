import { describe, it, expect } from "vitest";
import { generateHtml } from "../../src/modules/reporting/html.js";
import type { RunMeta } from "../../src/modules/reporting/types.js";
import { fullScored, fbOnly, nullScore, specialChars } from "./fixtures/leads.js";

const runMeta: RunMeta = {
  runId: "test-run-id",
  niche: "peluquerías",
  location: "Montevideo",
  generatedAt: "2024-01-01T00:00:00Z",
};

describe("generateHtml", () => {
  it("is a single file — no <link href> or <script src> pointing to external origins", () => {
    const html = generateHtml([fullScored, fbOnly], runMeta);
    // Must not contain external stylesheet or script references
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
  });

  it("contains inline <style> and <script> blocks", () => {
    const html = generateHtml([fullScored], runMeta);
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    // Must have meaningful content (not just empty tags)
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(styleMatch?.[1]?.length).toBeGreaterThan(100);
    expect(scriptMatch?.[1]?.length).toBeGreaterThan(50);
  });

  it("renders one data-row per lead", () => {
    const html = generateHtml([fullScored, fbOnly, nullScore], runMeta);
    const matches = html.match(/class="data-row"/g);
    expect(matches).toHaveLength(3);
  });

  it("displays '—' for null prospect_score (not '0')", () => {
    const html = generateHtml([nullScore], runMeta);
    // The badge for this lead should show "—" not "0"
    expect(html).toContain(">—<");
    // Ensure "0" does not appear as a score badge value for this lead
    const badgeSection = html.match(/badge[^>]*data-prospect=""[^>]*>(.*?)<\/span>/s);
    if (badgeSection) {
      expect(badgeSection[1]).toBe("—");
    }
  });

  it("applies correct badge color class for each score range", () => {
    const green = { ...fullScored, prospect_score: 70 };
    const yellow = { ...fullScored, place_id: "y", prospect_score: 50 };
    const red = { ...fbOnly, prospect_score: 0 };
    const html = generateHtml([green, yellow, red], runMeta);
    expect(html).toContain("badge-green");
    expect(html).toContain("badge-yellow");
    expect(html).toContain("badge-red");
  });

  it("has data-search attribute on each data row", () => {
    const html = generateHtml([fullScored, fbOnly], runMeta);
    const matches = html.match(/data-search="/g);
    expect(matches).toHaveLength(2);
  });

  it("XSS: name with </script> tag is HTML-escaped", () => {
    const evil = {
      ...fullScored,
      place_id: "evil",
      name: '</script><img src=x onerror="alert(1)">',
    };
    const html = generateHtml([evil], runMeta);
    expect(html).not.toContain("</script><img");
    // The name should appear escaped
    expect(html).toContain("&lt;/script&gt;");
  });
});

describe("N9.3/N101: safeUrl en href de website", () => {
  it("un website javascript: no llega al href", () => {
    const html = generateHtml([{ ...fullScored, website: "javascript:alert(1)" }], runMeta);
    expect(html).not.toContain('href="javascript:');
  });

  it("un website https sí se linkea", () => {
    const html = generateHtml([{ ...fullScored, website: "https://negocio.uy" }], runMeta);
    expect(html).toContain('href="https://negocio.uy"');
  });
});
