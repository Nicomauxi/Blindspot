import { describe, expect, it } from "vitest";
import { computePitchHook } from "../../src/modules/scoring/pitch.js";
import { topSignalForOffer } from "../../src/modules/scoring/offerings.js";
import type { Lead } from "../../src/shared/types.js";

function leadWith(partial: Partial<Lead>): Lead {
  return {
    id: "x",
    name: "Café del Sol",
    niche: "restaurant",
    tags: [],
    corroborating_sources: [],
    ...partial,
  } as unknown as Lead;
}

describe("M2: pitch_hook personalizado por lead", () => {
  it("topSignalForOffer devuelve la señal concreta más fuerte (high>medium>low)", () => {
    const sig = topSignalForOffer("rediseno", ["site-unreachable", "ssl-missing"], null);
    expect(sig?.label).toBe("Sitio web inaccesible"); // high gana a medium
  });

  it("topSignalForOffer devuelve null cuando no hay evidencia concreta", () => {
    expect(topSignalForOffer("software", [], null)).toBeNull();
  });

  it("el pitch incorpora el nombre del negocio y la evidencia concreta del lead", () => {
    const lead = leadWith({ name: "Rocco's", tags: ["site-unreachable"] });
    const hook = computePitchHook(lead, "rediseno");
    expect(hook).toContain("Rocco's");
    expect(hook.toLowerCase()).toContain("inaccesible");
  });

  it("dos leads con el mismo offer pero distinta evidencia producen pitches distintos", () => {
    const a = computePitchHook(leadWith({ name: "A", tags: ["site-unreachable"] }), "rediseno");
    const b = computePitchHook(leadWith({ name: "B", tags: ["not-responsive"] }), "rediseno");
    expect(a).not.toBe(b);
  });

  it("offer=none sigue marcando revisión manual (no inventa pitch)", () => {
    expect(computePitchHook(leadWith({}), "none")).toContain("revisar manualmente");
  });
});
