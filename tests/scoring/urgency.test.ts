import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeUrgencySignal } from "../../src/modules/scoring/urgency.js";
import type { Lead } from "../../src/shared/types.js";
import { empty_lead } from "./fixtures/leads.js";

// Freeze time: fixture created_at="2026-04-18" → 91 days before 2026-07-18 → not "recently_discovered" (< 90d).
const FAKE_NOW = new Date("2026-07-18T00:00:00.000Z").getTime();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FAKE_NOW); });
afterEach(() => { vi.useRealTimers(); });

function lead(overrides: Partial<Lead> = {}): Lead {
  return { ...empty_lead, ...overrides };
}

function withCopyrightYear(year: number): Partial<Lead> {
  return {
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00Z",
      copyright_year: year,
    },
  } as unknown as Partial<Lead>;
}

describe("high urgency — copyright_year", () => {
  it("copyright_year 2020 → high", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2020)))).toBe("high");
  });
  it("copyright_year 2019 → high", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2019)))).toBe("high");
  });
  it("copyright_year 2021 → no high por copyright", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2021)))).not.toBe("high");
  });
  it("copyright_year null → low", () => {
    expect(computeUrgencySignal(lead())).toBe("low");
  });
});

describe("high urgency — zona turística", () => {
  it("restaurant en Punta del Este → high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "Av. Gorlero 1234, Punta del Este" }))).toBe("high");
  });
  it("restaurant en Rocha → high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "Calle 1, Rocha" }))).toBe("high");
  });
  it("restaurant en Montevideo → no high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "18 de Julio 100, Montevideo" }))).not.toBe("high");
  });
  it("gym en Punta del Este → no high (niche no turístico)", () => {
    expect(computeUrgencySignal(lead({ niche: "gym", address: "Punta del Este" }))).not.toBe("high");
  });
});

describe("N01: la frescura del dato NO es urgencia del negocio", () => {
  it("un lead recién descubierto sin otras señales → low (antes 97,3% medium)", () => {
    const d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d }))).toBe("low");
  });
});

describe("medium urgency — negocio en crecimiento", () => {
  it("review_count=15, rating=4.5 → medium", () => {
    expect(computeUrgencySignal(lead({ review_count: 15, rating: 4.5 }))).toBe("medium");
  });
  it("review_count=19, rating=4.0 → medium (threshold exacto)", () => {
    expect(computeUrgencySignal(lead({ review_count: 19, rating: 4.0 }))).toBe("medium");
  });
  it("review_count=20, rating=4.5 → low (fuera del threshold)", () => {
    expect(computeUrgencySignal(lead({ review_count: 20, rating: 4.5 }))).toBe("low");
  });
  it("review_count=10, rating=3.9 → low (rating bajo)", () => {
    expect(computeUrgencySignal(lead({ review_count: 10, rating: 3.9 }))).toBe("low");
  });
});

describe("prioridad: high > medium", () => {
  it("copyright_year + negocio nuevo → high gana", () => {
    const d = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d, ...withCopyrightYear(2018) }))).toBe("high");
  });
});

describe("sin señales → low", () => {
  it("lead vacío → low", () => {
    expect(computeUrgencySignal(lead())).toBe("low");
  });
});
