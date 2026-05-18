import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectSubNiche } from "../../src/modules/enrichment/sub-niche-detection.js";
import type { Lead } from "../../src/shared/types.js";

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Negocio Test",
    address: "Montevideo",
    niche: "other",
    source: "yelu",
    passed_filter: true,
    tags: [],
    lead_company_data: null,
    ...overrides,
  } as unknown as Lead;
}

describe("detectSubNiche — keyword detection", () => {
  it("returns null for leads with niche != other", async () => {
    const lead = makeLead({ niche: "restaurant" });
    const result = await detectSubNiche(lead);
    expect(result).toBeNull();
  });

  it("detects veterinaria by name", async () => {
    const lead = makeLead({ name: "Veterinaria Central", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result).not.toBeNull();
    expect(result!.detected_sub_niche).toBe("veterinaria");
    expect(result!.sub_niche_source).toBe("keyword");
  });

  it("detects farmacia by name", async () => {
    const lead = makeLead({ name: "Farmacia del Centro", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result!.detected_sub_niche).toBe("farmacia");
  });

  it("detects ferreteria by name", async () => {
    const lead = makeLead({ name: "Ferretería El Clavo", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result!.detected_sub_niche).toBe("ferreteria");
  });

  it("detects optica by address/name", async () => {
    const lead = makeLead({ name: "Óptica Visión", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result!.detected_sub_niche).toBe("optica");
  });

  it("detects contabilidad", async () => {
    const lead = makeLead({ name: "Estudio Contable Fernández", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result!.detected_sub_niche).toBe("contabilidad");
  });

  it("returns null for unrecognized name when no LLM configured", async () => {
    const originalProvider = process.env["LLM_PROVIDER"];
    delete process.env["LLM_PROVIDER"];
    const lead = makeLead({ name: "Casa de Cambio Montevideo", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result).toBeNull();
    if (originalProvider) process.env["LLM_PROVIDER"] = originalProvider;
  });

  it("returns null if detected_sub_niche already present", async () => {
    const lead = makeLead({
      name: "Veterinaria Central",
      niche: "other",
      lead_company_data: { detected_sub_niche: "veterinaria" } as never,
    });
    const result = await detectSubNiche(lead);
    expect(result).toBeNull();
  });

  it("returns sub_niche_detected_at as ISO string", async () => {
    const lead = makeLead({ name: "Farmacia Sur", niche: "other" });
    const result = await detectSubNiche(lead);
    expect(result).not.toBeNull();
    expect(() => new Date(result!.sub_niche_detected_at)).not.toThrow();
  });
});
