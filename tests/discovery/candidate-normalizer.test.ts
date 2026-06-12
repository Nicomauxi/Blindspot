import { describe, it, expect } from "vitest";
import type { DiscoveryCandidate } from "../../src/shared/types.js";
import { normalizeCandidate, normalizeCandidates } from "../../src/modules/discovery/candidate-normalizer.js";

function cand(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    source: "miem_dei",
    external_id: "1",
    source_confidence: 0.9,
    name: "Negocio X",
    address: null,
    phone: null,
    website: null,
    email: null,
    latitude: null,
    longitude: null,
    niche: "other",
    raw: {},
    ...overrides,
  };
}

const ALIASES = [
  { niche: "bakery", term: "panaderia", matchType: "includes" },
  { niche: "restaurant", term: "restaurante", matchType: "includes" },
];

describe("normalizeCandidate", () => {
  it("reclasifica 'other' usando el niche_hint contra el vocabulario dinámico", () => {
    const c = normalizeCandidate(
      cand({ niche: "other", niche_hint: "Elaboración de pan — panaderia artesanal" }),
      ALIASES
    );
    expect(c.niche).toBe("bakery");
    expect(c.source).toBe("miem_dei"); // origen preservado
  });

  it("conserva el niche específico del provider cuando el vocabulario no matchea", () => {
    const c = normalizeCandidate(
      cand({ source: "osm", niche: "gym", niche_hint: "actividad no mapeada" }),
      ALIASES
    );
    expect(c.niche).toBe("gym");
  });

  it("queda 'other' cuando ni el vocabulario ni el provider clasifican", () => {
    const c = normalizeCandidate(cand({ niche: "other", niche_hint: "actividad rara n.c.p." }), ALIASES);
    expect(c.niche).toBe("other");
  });

  it("usa el nombre como hint cuando no hay niche_hint", () => {
    const c = normalizeCandidate(cand({ niche: "other", name: "Restaurante La Proa" }), ALIASES);
    expect(c.niche).toBe("restaurant");
  });

  it("no muta el candidate original (inmutable)", () => {
    const original = cand({ niche: "other", niche_hint: "panaderia" });
    const out = normalizeCandidate(original, ALIASES);
    expect(original.niche).toBe("other");
    expect(out.niche).toBe("bakery");
    expect(out).not.toBe(original);
  });
});

describe("F5.4: name placeholder y emails en website", () => {
  it("isPlaceholderName detecta N/A y variantes", async () => {
    const { isPlaceholderName } = await import("../../src/modules/discovery/candidate-normalizer.js");
    for (const bad of ["N/A", "n/a", "NA", "-", ".", "  ", ""]) {
      expect(isPlaceholderName(bad), bad).toBe(true);
    }
    expect(isPlaceholderName("Panadería Real")).toBe(false);
  });

  it("normalizeCandidates filtra candidates con name placeholder", () => {
    const out = normalizeCandidates([cand({ name: "N/A" }), cand({ name: "Real" })], ALIASES);
    expect(out.map((c) => c.name)).toEqual(["Real"]);
  });

  it("un email en website se mueve al campo email", () => {
    const c = normalizeCandidate(cand({ website: "gperalta@estudio.com.uy" }), ALIASES);
    expect(c.website).toBeNull();
    expect(c.email).toBe("gperalta@estudio.com.uy");
  });

  it("no pisa un email existente y una URL real no se toca", () => {
    const keep = normalizeCandidate(
      cand({ website: "info@x.uy", email: "ya@existe.uy" }),
      ALIASES
    );
    expect(keep.email).toBe("ya@existe.uy");
    expect(keep.website).toBeNull();

    const url = normalizeCandidate(cand({ website: "https://negocio.uy" }), ALIASES);
    expect(url.website).toBe("https://negocio.uy");
  });
});

describe("normalizeCandidates", () => {
  it("normaliza un lote preservando source y demás campos", () => {
    const out = normalizeCandidates(
      [cand({ niche_hint: "panaderia", phone: "099123456" }), cand({ source: "osm", niche: "restaurant" })],
      ALIASES
    );
    expect(out[0]!.niche).toBe("bakery");
    expect(out[0]!.phone).toBe("099123456");
    expect(out[1]!.niche).toBe("restaurant");
  });
});
