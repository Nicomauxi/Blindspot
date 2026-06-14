import { describe, expect, it } from "vitest";
import { computeSecondaryOffer } from "../../api/src/routes/leads.js";

describe("C4: secondary_offer + confianza", () => {
  it("devuelve el 2º offer y confianza low cuando el gap es chico (volado)", () => {
    const r = computeSecondaryOffer({ software: 48, catalogo: 45, marketing: 10 });
    expect(r.secondary_offer).toBe("catalogo");
    expect(r.secondary_offer_score).toBe(45);
    expect(r.offer_confidence).toBe("low"); // gap 3
  });

  it("confianza high cuando el 1º domina claramente", () => {
    const r = computeSecondaryOffer({ software: 60, catalogo: 20 });
    expect(r.offer_confidence).toBe("high"); // gap 40
  });

  it("confianza medium en gap intermedio", () => {
    const r = computeSecondaryOffer({ web_nuevo: 30, rediseno: 22 });
    expect(r.offer_confidence).toBe("medium"); // gap 8
  });

  it("sin segundo offer: secondary null pero confianza high (1 solo offer)", () => {
    const r = computeSecondaryOffer({ software: 40 });
    expect(r.secondary_offer).toBeNull();
    expect(r.offer_confidence).toBe("high"); // gap = 40 - 0
  });

  it("sin offers positivos: todo null", () => {
    const r = computeSecondaryOffer({ software: 0, catalogo: 0 });
    expect(r).toEqual({ secondary_offer: null, secondary_offer_score: null, offer_confidence: null });
  });
});
