import { describe, expect, it } from "vitest";
import type { DiscoveryCandidate, Lead } from "../../src/shared/types.js";
import {
  buildCanonicalField,
  canonicalFieldEntry,
  GOOGLE_SOURCE,
} from "../../src/storage/canonical-field.js";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "p-1",
    source: GOOGLE_SOURCE,
    external_id: "g-1",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "other",
    name: "Negocio",
    address: null,
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    inferred_state: null,
    gps: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    source: "mintur",
    external_id: "m-1",
    source_confidence: 0.7,
    name: "Negocio",
    address: null,
    phone: null,
    website: null,
    email: null,
    latitude: null,
    longitude: null,
    niche: null,
    raw: {},
    ...overrides,
  };
}

describe("buildCanonicalField — campos nuevos / omisión de opcionales", () => {
  it("campo nuevo (solo candidato) no emite keys opcionales", () => {
    const result = buildCanonicalField(lead(), "phone", candidate({ phone: "099111222" }), "099111222");
    expect(result).toEqual({
      value: "099111222",
      confidence: 0.7,
      sources: ["mintur"],
      conflict: false,
    });
    expect(result).not.toHaveProperty("method");
    expect(result).not.toHaveProperty("stale");
    expect(result).not.toHaveProperty("conflict_alternatives");
  });

  it("corroboración acumula fuentes y sube confianza sin keys opcionales", () => {
    const base = lead({ phone: "099111222", source_confidence: 0.7 });
    const result = buildCanonicalField(base, "phone", candidate({ source: "osm", phone: "099111222" }), "099111222");
    expect(result?.value).toBe("099111222");
    expect(result?.sources).toEqual([GOOGLE_SOURCE, "osm"]);
    expect(result?.confidence).toBe(0.85);
    expect(result?.conflict).toBe(false);
    expect(result).not.toHaveProperty("conflict_alternatives");
  });
});

describe("buildCanonicalField — address vía geo-text", () => {
  it("normaliza dirección equivalente como corroboración (no conflicto)", () => {
    const base = lead({ address: "Av. Principal 123, Montevideo", source_confidence: 0.7 });
    const result = buildCanonicalField(
      base,
      "address",
      candidate({ source: "osm", address: "AVENIDA Principal 123, montevideo" }),
      "AVENIDA Principal 123, montevideo"
    );
    expect(result?.conflict).toBe(false);
    expect(result?.sources).toEqual([GOOGLE_SOURCE, "osm"]);
  });
});

describe("buildCanonicalField — conflicto google-priority", () => {
  it("Google existente gana frente a candidato no-Google y guarda alternativa", () => {
    const base = lead({ address: "Calle Google 100", source: GOOGLE_SOURCE });
    const result = buildCanonicalField(
      base,
      "address",
      candidate({ source: "mintur", source_confidence: 0.95, address: "Calle Social 200" }),
      "Calle Social 200"
    );
    expect(result?.value).toBe("Calle Google 100");
    expect(result?.conflict).toBe(true);
    expect(result?.method).toBe("google_priority");
    expect(result?.conflict_alternatives).toEqual([
      { value: "Calle Social 200", confidence: 0.95, sources: ["mintur"], source: "mintur" },
    ]);
  });

  it("Google candidato gana frente a existente no-Google", () => {
    const base = lead({ address: "Calle Vieja 1", source: "mintur", source_confidence: 0.8 });
    const result = buildCanonicalField(
      base,
      "address",
      candidate({ source: GOOGLE_SOURCE, source_confidence: 0.6, address: "Calle Google 2" }),
      "Calle Google 2"
    );
    expect(result?.value).toBe("Calle Google 2");
    expect(result?.method).toBe("google_priority");
    expect(result?.conflict_alternatives?.[0]?.value).toBe("Calle Vieja 1");
  });
});

describe("buildCanonicalField — cuenta social abandonada (stale)", () => {
  it("fuente con confianza <= 0.2 marca stale en campo nuevo", () => {
    const result = buildCanonicalField(
      lead({ address: null }),
      "address",
      candidate({ source: "social_fb", source_confidence: 0.2, address: "Dir social vieja" }),
      "Dir social vieja"
    );
    expect(result?.stale).toBe(true);
  });

  it("social abandonada nunca gana un conflicto contra valor más confiable", () => {
    const base = lead({ address: "Dir Google", source: GOOGLE_SOURCE, source_confidence: 0.9 });
    const result = buildCanonicalField(
      base,
      "address",
      candidate({ source: "social_fb", source_confidence: 0.2, address: "Dir social abandonada" }),
      "Dir social abandonada"
    );
    expect(result?.value).toBe("Dir Google");
    expect(result?.conflict).toBe(true);
    expect(result?.conflict_alternatives?.[0]?.value).toBe("Dir social abandonada");
  });
});

describe("buildCanonicalField — acumulación de conflict_alternatives", () => {
  it("preserva alternativas previas + agrega la nueva, dedup por valor normalizado", () => {
    const base = lead({
      address: "Calle A 100",
      source: GOOGLE_SOURCE,
      canonical_fields: {
        address: {
          value: "Calle A 100",
          confidence: 0.9,
          sources: [GOOGLE_SOURCE],
          conflict: true,
          conflict_alternatives: [{ value: "Calle B 200", confidence: 0.8, sources: ["mintur"], source: "mintur" }],
        },
      },
    });
    const result = buildCanonicalField(
      base,
      "address",
      candidate({ source: "osm", source_confidence: 0.7, address: "Calle C 300" }),
      "Calle C 300"
    );
    // Google sigue canónico; B (previa) y C (nueva) ambas en alternativas, ninguna duplicada.
    expect(result?.value).toBe("Calle A 100");
    const altValues = (result?.conflict_alternatives ?? []).map((a) => a.value).sort();
    expect(altValues).toEqual(["Calle B 200", "Calle C 300"]);
  });

  it("no duplica una alternativa equivalente ya presente (clave normalizada)", () => {
    const base = lead({
      phone: "+59899111222",
      source: GOOGLE_SOURCE,
      canonical_fields: {
        phone: {
          value: "+59899111222",
          confidence: 0.9,
          sources: [GOOGLE_SOURCE],
          conflict: true,
          conflict_alternatives: [{ value: "099333444", confidence: 0.7, sources: ["mintur"], source: "mintur" }],
        },
      },
    });
    // Mismo teléfono que la alternativa previa, distinto formato → no debe duplicar.
    const result = buildCanonicalField(
      base,
      "phone",
      candidate({ source: "osm", source_confidence: 0.6, phone: "099 333 444" }),
      "099 333 444"
    );
    expect(result?.conflict_alternatives).toHaveLength(1);
  });
});

describe("canonicalFieldEntry — preserva opcionales sólo si presentes", () => {
  it("coerciona string plano sin opcionales", () => {
    expect(canonicalFieldEntry("hola")).toEqual({ value: "hola", confidence: 0.5, sources: [], conflict: false });
  });

  it("preserva stale/method/conflict_alternatives si venían", () => {
    const entry = canonicalFieldEntry({
      value: "x",
      confidence: 0.4,
      sources: ["a"],
      conflict: true,
      stale: true,
      method: "google_priority",
      conflict_alternatives: [{ value: "y", confidence: 0.3, sources: ["b"], source: "b" }],
    });
    expect(entry?.stale).toBe(true);
    expect(entry?.method).toBe("google_priority");
    expect(entry?.conflict_alternatives).toHaveLength(1);
  });
});
