import { describe, expect, it } from "vitest";
import { commercialSummaryMatchesOffer } from "../../api/src/routes/leads.js";

function s(software: number, marketing: number, primary: "marketing" | "software" | "both" | "unknown") {
  return { software_score: software, marketing_score: marketing, primary_offer_type: primary } as const;
}

describe("commercialSummaryMatchesOffer — filtro inclusivo de oferta", () => {
  it("doble oferta aparece al filtrar por marketing y por software", () => {
    expect(commercialSummaryMatchesOffer(s(5, 5, "both"), "marketing")).toBe(true);
    expect(commercialSummaryMatchesOffer(s(5, 5, "both"), "software")).toBe(true);
    expect(commercialSummaryMatchesOffer(s(5, 5, "both"), "both")).toBe(true);
  });

  it("oferta única no matchea la otra capacidad", () => {
    expect(commercialSummaryMatchesOffer(s(5, 0, "software"), "marketing")).toBe(false);
    expect(commercialSummaryMatchesOffer(s(0, 5, "marketing"), "software")).toBe(false);
  });

  it("'both' exige ambas capacidades", () => {
    expect(commercialSummaryMatchesOffer(s(5, 0, "software"), "both")).toBe(false);
    expect(commercialSummaryMatchesOffer(s(0, 5, "marketing"), "both")).toBe(false);
  });

  it("unknown", () => {
    expect(commercialSummaryMatchesOffer(s(0, 0, "unknown"), "unknown")).toBe(true);
    expect(commercialSummaryMatchesOffer(s(0, 0, "unknown"), "marketing")).toBe(false);
  });

  it("sin filtro: pasa cualquiera", () => {
    expect(commercialSummaryMatchesOffer(s(0, 0, "unknown"), undefined)).toBe(true);
    expect(commercialSummaryMatchesOffer(s(5, 5, "both"), undefined)).toBe(true);
  });
});
