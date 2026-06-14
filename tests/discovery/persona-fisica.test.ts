import { describe, it, expect } from "vitest";
import { isPersonaFisicaRejection, personaFisicaRedaction, PERSONA_FISICA_REJECTION } from "../../src/modules/discovery/persona-fisica.js";

describe("persona-fisica (minimización Ley 18.331)", () => {
  it("isPersonaFisicaRejection detecta el motivo persona-fisica", () => {
    expect(isPersonaFisicaRejection(["persona-fisica"])).toBe(true);
    expect(isPersonaFisicaRejection(["no-contact", "persona-fisica"])).toBe(true);
    expect(isPersonaFisicaRejection(["no-contact"])).toBe(false);
    expect(isPersonaFisicaRejection(null)).toBe(false);
    expect(isPersonaFisicaRejection(undefined)).toBe(false);
  });

  it("personaFisicaRedaction marca is_natural_person y anula los datos personales", () => {
    const r = personaFisicaRedaction();
    expect(r.is_natural_person).toBe(true);
    for (const field of ["phone", "whatsapp", "address", "website", "gps", "source_data", "digital_footprint", "canonical_fields", "inferred_state", "score_breakdown", "notes", "contact_reliability_score", "data_confidence_score"]) {
      expect(r[field], field).toBeNull();
    }
  });

  it("NO incluye 'email' (no es columna de leads — vive en canonical_fields, que sí se anula)", () => {
    expect(Object.keys(personaFisicaRedaction())).not.toContain("email");
    expect(Object.keys(personaFisicaRedaction())).toContain("canonical_fields");
  });

  it("NO anula identificadores mínimos para no reprocesar (place_id/external_id/source/name)", () => {
    const keys = Object.keys(personaFisicaRedaction());
    for (const keep of ["place_id", "external_id", "source", "name"]) {
      expect(keys, keep).not.toContain(keep);
    }
  });

  it("la constante del motivo es estable", () => {
    expect(PERSONA_FISICA_REJECTION).toBe("persona-fisica");
  });
});
