import { describe, expect, it } from "vitest";
import { assertSourceCoverage, ACTIVE_SCORED_SOURCES } from "../../src/modules/scoring/config.js";

// N-SCORE.3: un source activo sin bonus caía a `?? 0` silencioso. assertSourceCoverage
// lo convierte en error explícito al cargar la config de producción.
describe("assertSourceCoverage (N-SCORE.3)", () => {
  it("pasa cuando todas las fuentes activas tienen bonus (incl. miem_dei de F1.4)", () => {
    const full = Object.fromEntries(ACTIVE_SCORED_SOURCES.map((s) => [s, 1]));
    expect(() => assertSourceCoverage(full)).not.toThrow();
    expect(ACTIVE_SCORED_SOURCES).toContain("miem_dei");
  });

  it("lanza nombrando las fuentes faltantes", () => {
    expect(() => assertSourceCoverage({ google_places: 0, osm: 8 })).toThrow(/miem_dei/);
    expect(() => assertSourceCoverage({})).toThrow(/sin cobertura/);
  });
});
