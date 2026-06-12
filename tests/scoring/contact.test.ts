import { describe, expect, it } from "vitest";
import { computeContactProfile, CONTACTABLE_TIERS } from "../../src/modules/scoring/contact.js";
import { empty_lead } from "./fixtures/leads.js";

describe("computeContactProfile", () => {
  it("email aislado queda en tier B hasta que aparezcan más canales", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      canonical_fields: { email: "owner@example.com" },
    });

    expect(profile.score).toBe(45);
    expect(profile.tier).toBe("B");
    expect(profile.signals).toEqual([
      { name: "email", weight: 45, value: 1 },
    ]);
  });

  it("multicanal fuerte sube a tier A (con relevancia de niche)", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      niche: "restaurant",
      canonical_fields: { email: "owner@example.com" },
      phone: "099123456",
      whatsapp: "099123456",
      website: "https://negocio.test",
      address: "18 de Julio 1234",
    });

    expect(profile.score).toBe(100);
    expect(profile.tier).toBe("A");
    expect(CONTACTABLE_TIERS.has(profile.tier)).toBe(true);
  });

  it("F3.1: contacto multicanal pero niche 'other' NO colapsa a A (→ B)", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      niche: "other",
      canonical_fields: { email: "owner@example.com" },
      phone: "099123456",
      whatsapp: "099123456",
      website: "https://negocio.test",
      address: "18 de Julio 1234",
    });
    expect(profile.score).toBe(100);
    expect(profile.tier).toBe("B");
  });

  it("F3.1: vertical B2B (industrial) con contacto rico NO es tier A (→ B)", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      niche: "restaurant",
      tags: ["vertical-industrial"],
      canonical_fields: { email: "owner@example.com" },
      phone: "099123456",
      whatsapp: "099123456",
      website: "https://negocio.test",
      address: "18 de Julio 1234",
    });
    expect(profile.tier).toBe("B");
  });

  it("direccion sola informa ubicación pero no contacto listo", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      address: "Sarandí 321",
    });

    expect(profile.score).toBe(8);
    expect(profile.tier).toBe("D");
    expect(CONTACTABLE_TIERS.has(profile.tier)).toBe(false);
  });

  it("usa la confiabilidad resuelta para el bonus alto aunque no venga persistida", () => {
    const profile = computeContactProfile({
      ...empty_lead,
      canonical_fields: { email: "owner@example.com" },
      phone: "099123456",
      whatsapp: "099123456",
    });

    expect(profile.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "high_confidence_bonus", weight: 4, value: 0.85 }),
      ])
    );
  });
});
