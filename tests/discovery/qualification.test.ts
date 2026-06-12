import { describe, expect, it } from "vitest";
import {
  candidateHasContact,
  leadHasContact,
  qualifyExternalLead,
} from "../../src/modules/discovery/qualification.js";
import type { DiscoveryCandidate, Lead } from "../../src/shared/types.js";

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    source: "osm",
    external_id: "1",
    source_confidence: 0.6,
    name: "X",
    address: "calle, Montevideo",
    phone: null,
    website: null,
    email: null,
    latitude: null,
    longitude: null,
    niche: "restaurant",
    raw: {},
    ...overrides,
  };
}

describe("qualifyExternalLead", () => {
  it("un lead corroborado siempre pasa, sin importar contacto/fuente", () => {
    expect(qualifyExternalLead({ source: "pedidosya", hasContact: false, corroborated: true }))
      .toEqual({ passed_filter: true, rejection_reasons: [] });
  });

  it("rechaza sin contacto accionable", () => {
    const r = qualifyExternalLead({ source: "osm", hasContact: false, corroborated: false });
    expect(r.passed_filter).toBe(false);
    expect(r.rejection_reasons).toContain("no-contact");
  });

  it("pasa con al menos un canal de contacto (target: tel sin web)", () => {
    expect(qualifyExternalLead({ source: "mintur", hasContact: true, corroborated: false }))
      .toEqual({ passed_filter: true, rejection_reasons: [] });
  });

  it("pedidosya standalone (sin corroborar) se rechaza como fuente-señal", () => {
    const r = qualifyExternalLead({ source: "pedidosya", hasContact: false, corroborated: false });
    expect(r.passed_filter).toBe(false);
    expect(r.rejection_reasons).toContain("signal-source-only");
  });

  it("F1.3: un lead extranjero NO entra al pool, ni siquiera corroborado", () => {
    const r = qualifyExternalLead({ source: "osm", hasContact: true, corroborated: true, foreign: true });
    expect(r.passed_filter).toBe(false);
    expect(r.rejection_reasons).toEqual(["geo-out-of-country"]);
  });

  it("F1.4: vertical industrial/otro NO entra al pool comercial, aun corroborada", () => {
    const ind = qualifyExternalLead({ source: "miem_dei", hasContact: true, corroborated: true, vertical: "industrial" });
    expect(ind).toEqual({ passed_filter: false, rejection_reasons: ["non-commercial-vertical"] });
    const otro = qualifyExternalLead({ source: "miem_dei", hasContact: true, corroborated: false, vertical: "otro" });
    expect(otro.passed_filter).toBe(false);
    expect(otro.rejection_reasons).toContain("non-commercial-vertical");
  });

  it("F1.4: vertical comercio-local sigue el gate normal (pasa con contacto)", () => {
    const r = qualifyExternalLead({ source: "miem_dei", hasContact: true, corroborated: false, vertical: "comercio-local" });
    expect(r).toEqual({ passed_filter: true, rejection_reasons: [] });
  });
});

describe("candidateHasContact", () => {
  it("detecta phone/website/email", () => {
    expect(candidateHasContact(candidate({ phone: "099" }))).toBe(true);
    expect(candidateHasContact(candidate({ website: "https://x.uy" }))).toBe(true);
    expect(candidateHasContact(candidate({ email: "a@b.com" }))).toBe(true);
    expect(candidateHasContact(candidate())).toBe(false);
  });
});

describe("leadHasContact", () => {
  const baseLead = { phone: null, website: null, canonical_fields: null, digital_footprint: null } as unknown as Lead;

  it("detecta contacto directo", () => {
    expect(leadHasContact({ ...baseLead, phone: "099" } as Lead)).toBe(true);
  });
  it("detecta canonical_fields", () => {
    expect(leadHasContact({ ...baseLead, canonical_fields: { email: { value: "a@b.com" } } } as unknown as Lead)).toBe(true);
  });
  it("detecta email/social en digital_footprint", () => {
    expect(leadHasContact({ ...baseLead, digital_footprint: { contact_emails: ["a@b.com"] } } as unknown as Lead)).toBe(true);
    expect(leadHasContact({ ...baseLead, digital_footprint: { social_search: { instagram: { url: "https://ig/x" } } } } as unknown as Lead)).toBe(true);
  });
  it("sin contacto devuelve false", () => {
    expect(leadHasContact(baseLead)).toBe(false);
  });
});
