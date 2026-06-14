import { describe, it, expect } from "vitest";
import { buildCommercialOfferings } from "../../src/modules/scoring/offerings.js";

function subScores(overrides: Record<string, number> = {}): Record<string, unknown> {
  return {
    web_nuevo: 0,
    rediseno: 0,
    marketing: 0,
    software: 0,
    catalogo: 0,
    contacto_directo: 0,
    primary_offer: "none",
    ...overrides,
  };
}

function scoreBreakdown(scores: Record<string, number> = {}): Record<string, unknown> {
  return { sub_scores: subScores(scores) };
}

describe("buildCommercialOfferings — has_data", () => {
  it("returns has_data:false when no tags and no score_breakdown", () => {
    const result = buildCommercialOfferings([], null, null);
    expect(result.has_data).toBe(false);
    expect(result.software).toHaveLength(0);
    expect(result.marketing).toHaveLength(0);
  });

  it("returns has_data:true when there are matching tags even without score_breakdown", () => {
    const result = buildCommercialOfferings(["no-website"], null, null);
    expect(result.has_data).toBe(true);
  });

  it("returns has_data:true when sub_scores have non-zero values", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ web_nuevo: 35 }), null);
    expect(result.has_data).toBe(true);
  });
});

describe("buildCommercialOfferings — software track", () => {
  it("includes web_nuevo offering when score > 0", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ web_nuevo: 45 }), null);
    const webNuevo = result.software.find((o) => o.id === "web_nuevo");
    expect(webNuevo).toBeDefined();
    expect(webNuevo!.score).toBe(45);
  });

  it("sets high confidence when score >= 55", () => {
    const result = buildCommercialOfferings(["no-website"], scoreBreakdown({ web_nuevo: 60 }), null);
    const webNuevo = result.software.find((o) => o.id === "web_nuevo");
    expect(webNuevo!.confidence).toBe("high");
  });

  it("sets medium confidence when score is 20-54", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ web_nuevo: 35 }), null);
    const webNuevo = result.software.find((o) => o.id === "web_nuevo");
    expect(webNuevo!.confidence).toBe("medium");
  });

  it("sets low confidence when score < 20", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ web_nuevo: 10 }), null);
    const webNuevo = result.software.find((o) => o.id === "web_nuevo");
    expect(webNuevo!.confidence).toBe("low");
  });

  it("includes no-website signal with high weight", () => {
    const result = buildCommercialOfferings(["no-website"], scoreBreakdown({ web_nuevo: 35 }), null);
    const webNuevo = result.software.find((o) => o.id === "web_nuevo");
    const signal = webNuevo!.signals.find((s) => s.label === "No tiene sitio web");
    expect(signal).toBeDefined();
    expect(signal!.weight).toBe("high");
  });

  it("includes rediseno with ssl-missing signal", () => {
    const result = buildCommercialOfferings(["ssl-missing"], scoreBreakdown({ rediseno: 10 }), null);
    const rediseno = result.software.find((o) => o.id === "rediseno");
    expect(rediseno).toBeDefined();
    const signal = rediseno!.signals.find((s) => s.label === "Sin certificado HTTPS");
    expect(signal).toBeDefined();
  });

  it("sorts offerings by score descending", () => {
    const result = buildCommercialOfferings(
      [],
      scoreBreakdown({ web_nuevo: 35, rediseno: 50, software: 20, catalogo: 10 }),
      null
    );
    const scores = result.software.map((o) => o.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it("includes catalogo with digital_footprint signals", () => {
    const digitalFootprint = {
      operational_systems: {
        ecommerce_platforms: [],
        menu_links: [],
      },
    };
    const result = buildCommercialOfferings([], scoreBreakdown({ catalogo: 45 }), digitalFootprint);
    const catalogo = result.software.find((o) => o.id === "catalogo");
    expect(catalogo).toBeDefined();
    expect(catalogo!.signals.some((s) => s.label === "Sin tienda online")).toBe(true);
  });
});

describe("buildCommercialOfferings — marketing track", () => {
  it("includes marketing offering when web-only-no-social tag present", () => {
    const result = buildCommercialOfferings(["web-only-no-social"], scoreBreakdown({ marketing: 28 }), null);
    expect(result.marketing).toHaveLength(1);
    const marketing = result.marketing[0]!;
    expect(marketing.id).toBe("marketing");
    const signal = marketing.signals.find((s) => s.label === "Sin presencia en redes sociales");
    expect(signal).toBeDefined();
    expect(signal!.weight).toBe("high");
  });

  it("returns empty marketing when score is 0 and no signals", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ marketing: 0 }), null);
    expect(result.marketing).toHaveLength(0);
  });

  it("pixel-missing generates low weight signal", () => {
    const result = buildCommercialOfferings(["pixel-missing"], scoreBreakdown({ marketing: 5 }), null);
    const marketing = result.marketing[0]!;
    const signal = marketing.signals.find((s) => s.label === "Sin pixel de seguimiento");
    expect(signal!.weight).toBe("low");
  });
});

describe("buildCommercialOfferings — excludes zero offerings", () => {
  it("does not include offering with score 0 and no signals", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ web_nuevo: 0, rediseno: 0, software: 0, catalogo: 0 }), null);
    expect(result.software).toHaveLength(0);
  });
});

describe("buildCommercialOfferings — contacto_directo (N1.7)", () => {
  it("renderiza contacto_directo cuando es el único sub-score (no 'Sin señal')", () => {
    const result = buildCommercialOfferings(["mobile-phone"], scoreBreakdown({ contacto_directo: 30 }), null);
    const offer = result.software.find((o) => o.id === "contacto_directo");
    expect(offer).toBeDefined();
    expect(offer?.label).toBe("Contacto directo");
    expect(result.has_data).toBe(true);
  });

  it("NO renderiza contacto_directo cuando su score es 0", () => {
    const result = buildCommercialOfferings([], scoreBreakdown({ contacto_directo: 0 }), null);
    expect(result.software.find((o) => o.id === "contacto_directo")).toBeUndefined();
  });
});
