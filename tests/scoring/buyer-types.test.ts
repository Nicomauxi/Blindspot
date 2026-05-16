import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeAllBuyerScores } from "../../src/modules/scoring/buyer-types.js";
import { resetScoringConfigCache } from "../../src/modules/scoring/config.js";
import type { Lead } from "../../src/shared/types.js";
import { empty_lead } from "./fixtures/leads.js";

beforeEach(() => resetScoringConfigCache());
afterEach(() => resetScoringConfigCache());

function lead(overrides: Partial<Lead> = {}): Lead {
  return { ...empty_lead, ...overrides };
}

function withSubScores(scores: { web_nuevo?: number; rediseno?: number; marketing?: number; software?: number; catalogo?: number }) {
  return {
    score_breakdown: {
      computed_at: "2026-01-01T00:00:00Z",
      config_version: 1,
      business_quality: { total: 0, rules: [] },
      digital_gap: { total: 0, rules: [] },
      systems_gap: { total: 0, rules: [] },
      prospect: { formula: "", total: 0 },
      sub_scores: {
        web_nuevo: scores.web_nuevo ?? 0,
        rediseno: scores.rediseno ?? 0,
        marketing: scores.marketing ?? 0,
        software: scores.software ?? 0,
        catalogo: scores.catalogo ?? 0,
        primary_offer: "none" as const,
      },
    },
  };
}

function withInferredState(state: Partial<Record<string, boolean>>): Partial<Lead> {
  const fields = ["has_delivery", "has_reservations", "has_online_catalog", "has_ecommerce", "has_pos", "has_chat_support"];
  const inferred_state: Record<string, object> = {};
  for (const f of fields) {
    inferred_state[f] = { value: state[f] ?? false, confidence: 0.9, via: [] };
  }
  inferred_state["digitalization_level"] = "none";
  inferred_state["computed_at"] = "2026-01-01T00:00:00Z";
  return {
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00Z",
      inferred_state,
    },
  } as unknown as Partial<Lead>;
}

// ─── agencia_web ────────────────────────────────────────────────────────────

describe("agencia_web", () => {
  it("base score = web_nuevo*0.50 + rediseno*0.30 + marketing*0.20", () => {
    const l = lead({ ...withSubScores({ web_nuevo: 50, rediseno: 30, marketing: 20 }) });
    const scores = computeAllBuyerScores(l);
    const s = scores.find((x) => x.buyer_type === "agencia_web")!;
    // 50*0.50 + 30*0.30 + 20*0.20 = 25+9+4 = 38
    expect(s.score).toBe(38);
    expect(s.breakdown.base).toBe(38);
    expect(s.breakdown.adjustments).toBe(0);
  });

  it("no sub_scores → empty result", () => {
    const l = lead();
    expect(computeAllBuyerScores(l)).toHaveLength(0);
  });
});

// ─── software_pos ────────────────────────────────────────────────────────────

describe("software_pos", () => {
  it("bonus has_delivery +20", () => {
    const l = lead({
      ...withSubScores({ software: 40, catalogo: 20 }),
      ...withInferredState({ has_delivery: true }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "software_pos")!;
    // base = 40*0.50 + 20*0.20 = 20+4 = 24; adjustments = +20
    expect(s.score).toBe(44);
    expect(s.breakdown.adjustments).toBe(20);
  });

  it("penalty has_pos -50", () => {
    const l = lead({
      ...withSubScores({ software: 60 }),
      ...withInferredState({ has_pos: true }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "software_pos")!;
    // base = 60*0.50 = 30; penalty = -50; result = max(0, -20) = 0
    expect(s.score).toBe(0);
  });
});

// ─── delivery_propio ─────────────────────────────────────────────────────────

describe("delivery_propio", () => {
  it("inferred_required has_delivery=true — met → score > 0", () => {
    const l = lead({
      ...withSubScores({ software: 50, catalogo: 30 }),
      ...withInferredState({ has_delivery: true }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "delivery_propio")!;
    // base = 50*0.40 + 30*0.30 = 20+9 = 29; bonus has_delivery +30 → 59
    expect(s.score).toBe(59);
  });

  it("inferred_required has_delivery=true — not met → score = 0", () => {
    const l = lead({
      ...withSubScores({ software: 50, catalogo: 30 }),
      ...withInferredState({ has_delivery: false }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.score).toBe(0);
    expect(s.breakdown.applied_modifiers[0]).toMatch(/blocked:inferred/);
  });
});

// ─── reservas_online ─────────────────────────────────────────────────────────

describe("reservas_online", () => {
  it("gym + has_reservations=false → score > 0", () => {
    const l = lead({
      niche: "gym",
      ...withSubScores({ software: 50, catalogo: 20 }),
      ...withInferredState({ has_reservations: false }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "reservas_online")!;
    expect(s.score).toBeGreaterThan(0);
  });

  it("gym + has_reservations=true → score = 0 (inferred_required blocks)", () => {
    const l = lead({
      niche: "gym",
      ...withSubScores({ software: 50 }),
      ...withInferredState({ has_reservations: true }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "reservas_online")!;
    expect(s.score).toBe(0);
  });

  it("car_dealer → score = 0 (niche_required blocks)", () => {
    const l = lead({
      niche: "car_dealer",
      ...withSubScores({ software: 50 }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "reservas_online")!;
    expect(s.score).toBe(0);
    expect(s.breakdown.applied_modifiers[0]).toMatch(/blocked:niche/);
  });
});

// ─── whatsapp_business ───────────────────────────────────────────────────────

describe("whatsapp_business", () => {
  it("whatsapp-confirmed tag → computes score", () => {
    const l = lead({
      tags: ["whatsapp-confirmed"],
      ...withSubScores({ software: 40, marketing: 35, catalogo: 25 }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "whatsapp_business")!;
    // 40*0.40 + 35*0.35 + 25*0.25 = 16+12.25+6.25 = 34.5 → 35
    expect(s.score).toBeGreaterThan(0);
  });

  it("no whatsapp-confirmed tag → score = 0", () => {
    const l = lead({
      tags: [],
      ...withSubScores({ software: 40 }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "whatsapp_business")!;
    expect(s.score).toBe(0);
    expect(s.breakdown.applied_modifiers[0]).toMatch(/blocked:tag/);
  });
});

// ─── score clamped to [0, 100] ───────────────────────────────────────────────

describe("score boundaries", () => {
  it("score never exceeds 100", () => {
    const l = lead({
      tags: ["whatsapp-confirmed"],
      ...withSubScores({ software: 100, marketing: 100, catalogo: 100 }),
    });
    const scores = computeAllBuyerScores(l);
    for (const s of scores) {
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.score).toBeGreaterThanOrEqual(0);
    }
  });
});
