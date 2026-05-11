import { describe, it, expect } from "vitest";
import { generateMdPerLead } from "../../src/modules/reporting/md.js";
import { fullScored, nullScore, specialChars, fbOnly, fullEnriched } from "./fixtures/leads.js";

describe("generateMdPerLead", () => {
  it("returns one file per lead", () => {
    const map = generateMdPerLead([fullScored, fbOnly, nullScore]);
    expect(map.size).toBe(3);
  });

  it("rank padding: single digit rank when total ≤ 9", () => {
    const map = generateMdPerLead([fullScored]);
    const keys = [...map.keys()];
    // min padding is 2, so rank 1 of 1 → "01-..."
    expect(keys[0]).toMatch(/^01-/);
  });

  it("rank padding: 2-digit prefix for 10 leads", () => {
    const leads = Array.from({ length: 10 }, (_, i) => ({
      ...fullScored,
      id: `id-${i}`,
      place_id: `place-${i}`,
      name: `Business ${i}`,
      prospect_score: 10 - i,
    }));
    const map = generateMdPerLead(leads);
    const keys = [...map.keys()];
    expect(keys[0]).toMatch(/^01-/);
    expect(keys[9]).toMatch(/^10-/);
  });

  it("slug in filename is correct for specialChars lead", () => {
    const map = generateMdPerLead([specialChars]);
    const key = [...map.keys()][0];
    expect(key).toBe("01-cafe-nono-mas.md");
  });

  it("nullScore lead content contains WARNING section", () => {
    const map = generateMdPerLead([nullScore]);
    const content = [...map.values()][0] ?? "";
    expect(content).toContain("WARNING");
  });

  it("fullScored lead content contains breakdown rules with weight", () => {
    const map = generateMdPerLead([fullScored]);
    const content = [...map.values()][0] ?? "";
    expect(content).toContain("rating_excellent");
    expect(content).toContain("+25");
    expect(content).toContain("no_website");
    expect(content).toContain("+35");
  });

  it("content contains empty Notas section with HTML comment hint", () => {
    const map = generateMdPerLead([fullScored]);
    const content = [...map.values()][0] ?? "";
    expect(content).toContain("## Notas");
    expect(content).toContain("<!--");
  });

  it("fullEnriched: contact section includes heuristic web, social, and emails", () => {
    const map = generateMdPerLead([fullEnriched]);
    const content = [...map.values()][0] ?? "";
    expect(content).toContain("https://salonenriquecido.com.uy");
    expect(content).toContain("https://facebook.com/salonenriquecido");
    expect(content).toContain("https://instagram.com/salonenriquecido");
    expect(content).toContain("info@salonenriquecido.com.uy");
  });

  it("null footprint: contact section has no heuristic/social/email lines", () => {
    const map = generateMdPerLead([nullScore]);
    const content = [...map.values()][0] ?? "";
    expect(content).not.toContain("Web detectado:");
    expect(content).not.toContain("Facebook:");
    expect(content).not.toContain("Instagram:");
    expect(content).not.toContain("Email(s):");
  });
});
