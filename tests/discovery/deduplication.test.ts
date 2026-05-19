import { describe, it, expect } from "vitest";
import type { DiscoveryCandidate, Lead } from "../../src/shared/types.js";
import {
  levenshtein,
  normalizeName,
  nameSimilarity,
  findCrossSourceMatch,
  isFranchise,
} from "../../src/modules/discovery/deduplication.js";

function makeLead(overrides: Partial<Lead> & { name: string; source: Lead["source"] }): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    source: overrides.source,
    external_id: overrides.external_id ?? "ext-1",
    source_confidence: null,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: null,
    name: overrides.name,
    address: null,
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "new",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: overrides.prospect_score ?? null,
    passed_filter: false,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<DiscoveryCandidate> & { name: string; source: DiscoveryCandidate["source"] }): DiscoveryCandidate {
  return {
    source: overrides.source,
    external_id: overrides.external_id ?? "cand-1",
    source_confidence: 0.8,
    name: overrides.name,
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

// ─── levenshtein ─────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("returns 0 for identical strings", () => {
    expect(levenshtein("restaurante", "restaurante")).toBe(0);
  });

  it("returns 1 for strings differing by one character", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("returns length of longer string when one string is empty", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns expected distance for completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });
});

// ─── normalizeName ────────────────────────────────────────────────────────────

describe("normalizeName", () => {
  it("converts to lowercase", () => {
    expect(normalizeName("RESTAURANTE")).toBe("restaurante");
  });

  it("strips accent diacritics", () => {
    expect(normalizeName("café")).toBe("cafe");
    expect(normalizeName("Peña")).toBe("pena");
  });

  it("handles ñ correctly", () => {
    expect(normalizeName("España")).toBe("espana");
    expect(normalizeName("La Cañada")).toBe("la canada");
  });

  it("replaces punctuation and special chars with spaces", () => {
    expect(normalizeName("El-Farolito, Bar & Grill!")).toBe("el farolito bar grill");
  });

  it("collapses multiple spaces and trims", () => {
    expect(normalizeName("  La   Palma  ")).toBe("la palma");
  });
});

// ─── nameSimilarity ───────────────────────────────────────────────────────────

describe("nameSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(nameSimilarity("La Palma", "La Palma")).toBe(1.0);
  });

  it("returns 1.0 when both strings are empty", () => {
    expect(nameSimilarity("", "")).toBe(1.0);
  });

  it("returns 0.0 when one string is empty and the other is not", () => {
    expect(nameSimilarity("", "algo")).toBe(0.0);
    expect(nameSimilarity("algo", "")).toBe(0.0);
  });

  it("returns less than 0.3 for completely different names", () => {
    expect(nameSimilarity("Zapatería Moderna", "Farmacia Central")).toBeLessThan(0.3);
  });

  it("returns >= 0.85 for names with one-letter variation", () => {
    // "el faro" (7) vs "el farol" (8): levenshtein=1, similarity=1-1/8=0.875
    expect(nameSimilarity("El Faro", "El Farol")).toBeGreaterThanOrEqual(0.85);
  });

  it("returns >= 0.85 for names with accent difference", () => {
    expect(nameSimilarity("Café El Farolito", "Cafe El Farolito")).toBeGreaterThanOrEqual(0.85);
  });

  it("returns >= 0.85 for names with minor punctuation variation", () => {
    expect(nameSimilarity("El Farolito Bar", "El Farolito, Bar")).toBeGreaterThanOrEqual(0.85);
  });
});

// ─── findCrossSourceMatch ─────────────────────────────────────────────────────

describe("findCrossSourceMatch", () => {
  it("returns null for an empty leads array", () => {
    const candidate = makeCandidate({ name: "La Palma", source: "mintur" });
    expect(findCrossSourceMatch(candidate, [])).toBeNull();
  });

  it("ignores a lead with the same source and external_id (self-match)", () => {
    const candidate = makeCandidate({ name: "La Palma", source: "google_places", external_id: "ext-42" });
    const lead = makeLead({ name: "La Palma", source: "google_places", external_id: "ext-42" });
    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("ignores leads from the same source even when external_id differs", () => {
    const candidate = makeCandidate({ name: "La Palma", source: "google_places", external_id: "ext-1" });
    const lead = makeLead({ name: "La Palma", source: "google_places", external_id: "ext-99" });
    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("returns a lead with identical name from a different source", () => {
    const candidate = makeCandidate({ name: "El Farolito", source: "mintur" });
    const lead = makeLead({ name: "El Farolito", source: "google_places" });
    expect(findCrossSourceMatch(candidate, [lead])).toBe(lead);
  });

  it("returns null for a completely different name", () => {
    const candidate = makeCandidate({ name: "Hotel Ibis", source: "mintur" });
    const lead = makeLead({ name: "Farmacia Central", source: "google_places" });
    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("matches names with accent difference at default threshold 0.85", () => {
    // "cafe el farolito" (16) vs "cafe el farolito" (16) after NFD strip — identical → sim=1.0
    const candidate = makeCandidate({ name: "Café El Farolito", source: "mintur" });
    const lead = makeLead({ name: "Cafe El Farolito", source: "google_places" });
    const result = findCrossSourceMatch(candidate, [lead]);
    expect(result).toBe(lead);
  });

  it("respects a custom lower threshold (0.30 matches more distant names)", () => {
    // "la palma" (8) vs "la palma restaurante" (20): levenshtein=12, sim=1-12/20=0.4
    // At default 0.85 → no match; at 0.30 → matches
    const candidate = makeCandidate({ name: "La Palma", source: "mintur" });
    const lead = makeLead({ name: "La Palma Restaurante", source: "google_places" });
    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
    expect(findCrossSourceMatch(candidate, [lead], 0.30)).toBe(lead);
  });

  it("returns the lead with higher prospect_score on similarity tie", () => {
    const candidate = makeCandidate({ name: "La Palma", source: "mintur" });
    const leadLow = makeLead({ id: "low", name: "La Palma", source: "google_places", external_id: "ext-low", prospect_score: 30 });
    const leadHigh = makeLead({ id: "high", name: "La Palma", source: "yelu", external_id: "ext-high", prospect_score: 80 });
    const result = findCrossSourceMatch(candidate, [leadLow, leadHigh]);
    expect(result?.id).toBe("high");
  });

  it("returns alphabetically first lead by name when both prospect_scores are null on tie", () => {
    const candidate = makeCandidate({ name: "La Palma", source: "mintur" });
    const leadA = makeLead({ id: "a", name: "La Palma", source: "google_places", external_id: "ext-a", prospect_score: null });
    const leadB = makeLead({ id: "b", name: "La Palma", source: "yelu", external_id: "ext-b", prospect_score: null });
    const result = findCrossSourceMatch(candidate, [leadA, leadB]);
    expect(result?.id).toBe("a");
  });

  it("matches cross-source: mintur candidate vs google_places lead (same business)", () => {
    const candidate = makeCandidate({ name: "Restaurante La Peña", source: "mintur", external_id: "mintur-123" });
    const lead = makeLead({ name: "Restaurante La Pena", source: "google_places", external_id: "ChIJabc" });
    const result = findCrossSourceMatch(candidate, [lead]);
    expect(result).toBe(lead);
  });

  it("does not match when the niche differs", () => {
    const candidate = makeCandidate({
      name: "La Palma",
      source: "mintur",
      niche: "restaurant",
    });
    const lead = makeLead({
      name: "La Palma",
      source: "google_places",
      niche: "gym",
    });

    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("allows wildcard niche compatibility for mintur other against a typed lead", () => {
    const candidate = makeCandidate({
      name: "La Palma",
      source: "mintur",
      niche: "other",
    });
    const lead = makeLead({
      name: "La Palma",
      source: "google_places",
      niche: "restaurant",
    });

    expect(findCrossSourceMatch(candidate, [lead])).toBe(lead);
  });

  it("does not match when normalized city/address points to a different city", () => {
    const candidate = makeCandidate({
      name: "La Palma",
      source: "mintur",
      address: "Av. 18 de Julio 1234, Montevideo",
    });
    const lead = makeLead({
      name: "La Palma",
      source: "google_places",
      address: "Av. Gorlero 10, Punta del Este",
    });

    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("does not match when both leads have GPS and are farther than 500m apart", () => {
    const candidate = makeCandidate({
      name: "La Palma",
      source: "osm",
      latitude: -34.9011,
      longitude: -56.1645,
      address: "Av. 18 de Julio 1234, Montevideo",
    });
    const lead = makeLead({
      name: "La Palma",
      source: "google_places",
      address: "Av. 18 de Julio 1234, Montevideo",
      gps: "SRID=4326;POINT(-56.1920562 -34.9117128)",
    });

    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });

  it("matches when city aligns and GPS is within the guard radius", () => {
    const candidate = makeCandidate({
      name: "La Palma",
      source: "osm",
      latitude: -34.9011,
      longitude: -56.1645,
      address: "Av. 18 de Julio 1234, Montevideo",
    });
    const lead = makeLead({
      name: "La Palma",
      source: "google_places",
      address: "18 de Julio 1234, Montevideo",
      gps: "SRID=4326;POINT(-56.1649 -34.9013)",
    });

    expect(findCrossSourceMatch(candidate, [lead])).toBe(lead);
  });

  it("does not match below default threshold even from different source", () => {
    const candidate = makeCandidate({ name: "Hotel Asociación", source: "mintur" });
    const lead = makeLead({ name: "Farmacia del Centro", source: "google_places" });
    expect(findCrossSourceMatch(candidate, [lead])).toBeNull();
  });
});

describe("isFranchise", () => {
  const franchises = new Set(["Abitab", "McDonald's", "Hertz Rent A Car"]);

  it("matches exact name (case-insensitive)", () => {
    expect(isFranchise("ABITAB", franchises)).toBe(true);
  });

  it("matches with levenshtein ≤ 2 (typo — distancia 1)", () => {
    expect(isFranchise("Abita", franchises)).toBe(true);
  });

  it("does not match name too far from any franchise", () => {
    expect(isFranchise("Abitab Montevideo", franchises)).toBe(false);
  });

  it("returns false for non-franchise", () => {
    expect(isFranchise("Peluquería María", franchises)).toBe(false);
  });

  it("returns false for empty franchise set", () => {
    expect(isFranchise("Abitab", new Set())).toBe(false);
  });
});
