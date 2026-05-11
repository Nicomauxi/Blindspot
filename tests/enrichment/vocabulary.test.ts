import { describe, expect, it } from "vitest";
import { computeNicheStopWords } from "../../src/modules/enrichment/vocabulary.js";

describe("computeNicheStopWords", () => {
  it("returns empty map for no leads", () => {
    expect(computeNicheStopWords([], 3, 0.05)).toEqual(new Map());
  });

  it("counts words that appear in multiple leads and meets minCount threshold", () => {
    const leads = [
      { name: "Salon Bella" },
      { name: "Salon Linda" },
      { name: "Salon Rosa" },
    ];
    const result = computeNicheStopWords(leads, 3, 0);
    expect(result.get("salon")).toBe(3);
    expect(result.has("bella")).toBe(false);
    expect(result.has("linda")).toBe(false);
    expect(result.has("rosa")).toBe(false);
  });

  it("counts each word only once per lead even if repeated in name", () => {
    const leads = [
      { name: "Salon Salon Belle" },
      { name: "Salon Rosa" },
      { name: "Salon Verde" },
    ];
    const result = computeNicheStopWords(leads, 3, 0);
    expect(result.get("salon")).toBe(3);
  });

  it("excludes words shorter than 4 characters", () => {
    const leads = [
      { name: "Rio Mar Tech" },
      { name: "Rio Tech Store" },
      { name: "Rio Base Camp" },
    ];
    const result = computeNicheStopWords(leads, 3, 0);
    expect(result.has("rio")).toBe(false);
    expect(result.has("mar")).toBe(false);
    expect(result.get("tech")).toBe(2);
  });

  it("excludes STOP_WORDS (de, la, el, y, etc.) from counts", () => {
    const leads = [
      { name: "Taller de Autos" },
      { name: "Taller de Motos" },
      { name: "Taller de Bici" },
    ];
    const result = computeNicheStopWords(leads, 3, 0);
    expect(result.has("de")).toBe(false);
    expect(result.get("taller")).toBe(3);
  });

  it("respects minCount — words below threshold are excluded", () => {
    const leads = [
      { name: "Amaya Zone" },
      { name: "Zona Tech" },
      { name: "Delta Auto" },
    ];
    const result = computeNicheStopWords(leads, 3, 0);
    expect(result.size).toBe(0);
  });

  it("uses minFraction when it yields a higher threshold than minCount", () => {
    const leads = Array.from({ length: 20 }, (_, i) =>
      i < 2 ? { name: "Salon Tech" } : { name: `Unique${i} Place` }
    );
    // minCount=1, minFraction=0.1 → threshold=max(1, ceil(20*0.1))=max(1,2)=2
    const result = computeNicheStopWords(leads, 1, 0.1);
    expect(result.get("salon")).toBe(2);
    expect(result.get("tech")).toBe(2);
  });

  it("minFraction=0 and minCount=1 includes any word appearing at least once", () => {
    const leads = [{ name: "Bella Studio" }];
    const result = computeNicheStopWords(leads, 1, 0);
    expect(result.has("bella")).toBe(true);
    expect(result.has("studio")).toBe(true);
  });

  it("returns count as number of leads (not total word occurrences across leads)", () => {
    const leads = [
      { name: "Tech Salon Tech" },
      { name: "Tech Bella" },
    ];
    // "tech" appears in both leads, each lead counted once
    const result = computeNicheStopWords(leads, 2, 0);
    expect(result.get("tech")).toBe(2);
  });

  it("filters words from geographic_stop_words", () => {
    const leads = [
      { name: "Salto Fitness" },
      { name: "Salto Gym" },
      { name: "Salto Power" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.has("salto")).toBe(false);
  });

  it("filters centro as a generic vocabulary word", () => {
    const leads = [
      { name: "Centro Fitness" },
      { name: "Centro Gym" },
      { name: "Centro Power" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.has("centro")).toBe(false);
  });

  it("does not filter valid niche words such as peluqueria", () => {
    const leads = [
      { name: "Peluqueria Bella" },
      { name: "Peluqueria Linda" },
      { name: "Peluqueria Rosa" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.get("peluqueria")).toBe(3);
  });

  it("filters olivera from proper_noun_stop_words", () => {
    const leads = [
      { name: "Olivera Automoviles" },
      { name: "Olivera Autos" },
      { name: "Olivera Motors" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.has("olivera")).toBe(false);
  });

  it("filters vipercar from proper_noun_stop_words", () => {
    const leads = [
      { name: "Vipercar Automoviles" },
      { name: "Vipercar Autos" },
      { name: "Vipercar Motors" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.has("vipercar")).toBe(false);
  });

  it("does not filter valid niche terms such as automoviles", () => {
    const leads = [
      { name: "Olivera Automoviles" },
      { name: "Vipercar Automoviles" },
      { name: "Carrica Automoviles" },
    ];

    const result = computeNicheStopWords(leads, 3, 0);

    expect(result.get("automoviles")).toBe(3);
  });
});
