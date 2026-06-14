import { describe, it, expect } from "vitest";
import { classifyLegalPersonType, isLikelyNaturalPerson } from "../../src/modules/discovery/person-classifier.js";

describe("classifyLegalPersonType (Ley 18.331 — filtro de personas físicas)", () => {
  it("forma societaria explícita → juridica (varias grafías)", () => {
    for (const name of [
      "NORCHE S.A.S.", "NIVELTIC SA", "Abstracta S.R.L.", "AUTOMOTORA ARGENTINA SRL",
      "LARIALES S.A.", "TALLERES MONCAR S R L", "SISTEMAS L Y L S.A.", "REMOTOR LTDA.",
      "SOUTH BIOENERGY SAS", "APPEL SA", "COOPERATIVA BANCARIA",
    ]) {
      expect(classifyLegalPersonType(name), name).toBe("juridica");
    }
  });

  it("nombre completo (3+ tokens) o marcador personal → fisica", () => {
    expect(classifyLegalPersonType("Aguirre Berretta Maria Viviana")).toBe("fisica");
    expect(classifyLegalPersonType("Gonzalez Ferrer Rosana")).toBe("fisica");
    expect(classifyLegalPersonType("Pérez Rodríguez María")).toBe("fisica");
    expect(classifyLegalPersonType("Juan José Machado y otros")).toBe("fisica"); // marcador
    expect(classifyLegalPersonType("Sucesión de Pedro Gómez")).toBe("fisica"); // marcador
  });

  it("nombre de 2 tokens SIN marcador → unknown (precisión sobre recall; DGI lo resuelve)", () => {
    // Bajamos recall a propósito: 'Ocean Park'/'My Pet' eran falsos positivos con 2 tokens.
    expect(classifyLegalPersonType("Gomez Fernando")).toBe("unknown");
    expect(classifyLegalPersonType("Ocean Park")).toBe("unknown");
    expect(classifyLegalPersonType("My Pet")).toBe("unknown");
  });

  it("negocio con palabra comercial → unknown (no se afirma persona física)", () => {
    for (const name of [
      "BARRACA DE HIERROS CASTELLAN", "Almacén Juan", "Taller Gómez", "Hotel Humberto",
      "Restaurante La Pasiva", "Farmacia Central",
    ]) {
      expect(classifyLegalPersonType(name), name).toBe("unknown");
    }
  });

  it("nombre de fantasía de una palabra → unknown (se conserva)", () => {
    for (const name of ["Multifrío", "Oli", "GLESER", "SELIS", "Apisur", "ChivitosPro", "ABBOTT LABORATORIES"]) {
      expect(classifyLegalPersonType(name), name).toBe("unknown");
    }
  });

  it("vacío/nulo → unknown", () => {
    expect(classifyLegalPersonType(null)).toBe("unknown");
    expect(classifyLegalPersonType("")).toBe("unknown");
    expect(classifyLegalPersonType("   ")).toBe("unknown");
  });

  it("isLikelyNaturalPerson refleja la clasificación fisica", () => {
    expect(isLikelyNaturalPerson("Aguirre Berretta Maria Viviana")).toBe(true);
    expect(isLikelyNaturalPerson("LARIALES S.A.")).toBe(false);
    expect(isLikelyNaturalPerson("Multifrío")).toBe(false);
  });
});
