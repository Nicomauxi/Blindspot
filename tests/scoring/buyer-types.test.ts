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
      config_version: 2,
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
        contacto_directo: 0,
        primary_offer: "none" as const,
      },
      primary_offer: "none" as const,
      source_quality_bonus: 0,
      contact_tier: "X" as const,
      pitch_hook: "",
      urgency_signal: "low" as const,
      gap_depth: 0,
      commercial_breadth: 0,
      business_quality_pts: 0,
      accessibility_factor: 0,
      timing_factor: 0,
      urgency_bonus: 0,
      inferred_state_summary: {
        has_delivery: false,
        has_pos: false,
        has_reservations: false,
        has_ecommerce: false,
        digitalization_level: null,
      },
    },
  };
}

function withInferredState(state: Partial<Record<string, boolean>>): Partial<Lead> {
  const fields = ["has_delivery", "has_reservations", "has_online_catalog", "has_ecommerce", "has_pos", "has_chat_support"];
  const inferred_state: Record<string, object | string> = {};
  for (const f of fields) {
    inferred_state[f] = { value: state[f] ?? false, confidence: 0.9, via: [] };
  }
  inferred_state["digitalization_level"] = "none";
  inferred_state["computed_at"] = "2026-01-01T00:00:00Z";
  return {
    inferred_state: inferred_state as Lead["inferred_state"],
  };
}

function withTopLevelInferredState(state: Partial<Record<string, boolean>>): Partial<Lead> {
  const fields = ["has_delivery", "has_reservations", "has_online_catalog", "has_ecommerce", "has_pos", "has_chat_support"];
  const inferred_state: Record<string, object | string> = {};
  for (const f of fields) {
    inferred_state[f] = { value: state[f] ?? false, confidence: 0.9, via: [] };
  }
  inferred_state["digitalization_level"] = "none";
  inferred_state["computed_at"] = "2026-01-01T00:00:00Z";
  return {
    inferred_state: inferred_state as Lead["inferred_state"],
  };
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
    // N08 normalizado: base = (40*0.50 + 20*0.20)/0.70 = 24/0.7 ≈ 34; adjustments = +20
    expect(s.score).toBe(54);
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

  it("reads inferred_state from top-level lead column", () => {
    const l = lead({
      ...withSubScores({ software: 40, catalogo: 20 }),
      ...withTopLevelInferredState({ has_delivery: true }),
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "software_pos")!;
    expect(s.score).toBe(54); // N08 normalizado
  });

  it("BL-03: has_pos 'unknown' aplica penalización SUAVE (-7 = round(-50*0.15)), no cero", () => {
    const l = lead({
      ...withSubScores({ software: 60 }),
      inferred_state: { has_pos: { value: null, confidence: 0 }, digitalization_level: "none", computed_at: "2026-01-01T00:00:00Z" } as Lead["inferred_state"],
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "software_pos")!;
    expect(s.breakdown.adjustments).toBe(-7);
    expect(s.breakdown.applied_modifiers).toContain("penalty:has_pos:unknown:-7");
  });

  it("BL-03: has_pos verificado=false (confidence>0) NO penaliza (oferta relevante)", () => {
    const l = lead({
      ...withSubScores({ software: 60 }),
      ...withInferredState({ has_pos: false }), // value:false, confidence:0.9 → verificado
    });
    const s = computeAllBuyerScores(l).find((x) => x.buyer_type === "software_pos")!;
    expect(s.breakdown.adjustments).toBe(0);
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
    // N08 normalizado: base = (50*0.40 + 30*0.30)/0.70 = 29/0.7 ≈ 41; bonus +30 → 71
    expect(s.score).toBe(71);
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

// ─── delivery_propio commission_estimate ─────────────────────────────────────

describe("delivery_propio commission_estimate", () => {
  function pedidosYaLead(overrides: Partial<Lead> = {}): Lead {
    return lead({
      source: "pedidosya" as const,
      review_count: 50,
      niche: "restaurant",
      ...withSubScores({ software: 50, catalogo: 30 }),
      ...withInferredState({ has_delivery: true }),
      ...overrides,
    });
  }

  it("attaches commission_estimate when source=pedidosya and deliverySystemCostUyu provided", () => {
    const l = pedidosYaLead();
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 3000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.breakdown.commission_estimate).toBeDefined();
    const ce = s.breakdown.commission_estimate!;
    // monthly_orders_est = 50 * 2 = 100
    expect(ce.monthly_orders_est).toBe(100);
    // avg_ticket_uyu for restaurant = 350
    expect(ce.avg_ticket_uyu).toBe(350);
    // commission = 100 * 350 * 0.30 = 10500
    expect(ce.commission_monthly_uyu).toBe(10500);
    expect(ce.system_cost_monthly_uyu).toBe(3000);
    expect(ce.monthly_savings_est).toBe(7500);
  });

  it("uses corroborating_sources pedidosya if primary source is not pedidosya", () => {
    const l = pedidosYaLead({
      source: "yelu" as const,
      corroborating_sources: [{ source: "pedidosya" as const, external_id: "abc", confidence: 0.9 }],
    });
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 3000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.breakdown.commission_estimate).toBeDefined();
  });

  it("uses default avg_ticket when niche not in map", () => {
    const l = pedidosYaLead({ niche: "auto_repair" });
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 2000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    const ce = s.breakdown.commission_estimate!;
    // default avg_ticket = 300
    expect(ce.avg_ticket_uyu).toBe(300);
    expect(ce.commission_monthly_uyu).toBe(100 * 300 * 0.3); // 9000
  });

  it("no commission_estimate when deliverySystemCostUyu is not provided", () => {
    const l = pedidosYaLead();
    const scores = computeAllBuyerScores(l);
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.breakdown.commission_estimate).toBeUndefined();
  });

  it("no commission_estimate when lead is not from pedidosya", () => {
    const l = pedidosYaLead({ source: "yelu" as const, corroborating_sources: [] });
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 3000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.breakdown.commission_estimate).toBeUndefined();
  });

  it("no commission_estimate when delivery_propio score is 0 (not eligible)", () => {
    const l = pedidosYaLead({
      ...withInferredState({ has_delivery: false }),
    } as Partial<Lead>);
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 3000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    expect(s.score).toBe(0);
    expect(s.breakdown.commission_estimate).toBeUndefined();
  });

  it("review_count=null defaults to 0 orders", () => {
    const l = pedidosYaLead({ review_count: null });
    const scores = computeAllBuyerScores(l, { deliverySystemCostUyu: 3000 });
    const s = scores.find((x) => x.buyer_type === "delivery_propio")!;
    const ce = s.breakdown.commission_estimate!;
    expect(ce.monthly_orders_est).toBe(0);
    expect(ce.commission_monthly_uyu).toBe(0);
    expect(ce.monthly_savings_est).toBe(-3000);
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

// ─── N1.5: buyer scores recalibrados ───────────────────────────────────────

describe("N08: fórmula normalizada a la escala alcanzable", () => {
  it("software_pos con software=70 da base 50 (promedio ponderado), no 35", () => {
    const l = lead({ ...withSubScores({ software: 70, catalogo: 0 }), ...withInferredState({}) });
    const r = computeAllBuyerScores(l).find((s) => s.buyer_type === "software_pos")!;
    // pesos 0.50+0.20=0.70 → base = (70*0.5)/0.7 = 50
    expect(r.breakdown.base).toBe(50);
  });
});

describe("N13: inferred_required:false sin evidencia degrada en vez de pasar limpio", () => {
  it("ausencia NO verificada (confidence 0) → multiplicador de incertidumbre + modifier", () => {
    const inferred = withInferredState({ has_reservations: false });
    (inferred.inferred_state as Record<string, { value: boolean; confidence: number; via: string[] }>)["has_reservations"] = { value: false, confidence: 0, via: [] };
    const l = lead({ niche: "gym", ...withSubScores({ software: 70, catalogo: 70 }), ...inferred });
    const r = computeAllBuyerScores(l).find((s) => s.buyer_type === "reservas_online")!;
    expect(r.score).toBeGreaterThan(0);
    expect(r.breakdown.applied_modifiers).toContain("uncertain:has_reservations");

    const verified = lead({ niche: "gym", ...withSubScores({ software: 70, catalogo: 70 }), ...withInferredState({ has_reservations: false }) });
    const rv = computeAllBuyerScores(verified).find((s) => s.buyer_type === "reservas_online")!;
    expect(r.score).toBeLessThan(rv.score);
  });
});

describe("N14: whatsapp_business acepta whatsapp-derived con penalización", () => {
  it("derived → score > 0 con modifier; sin tag → bloqueado", () => {
    const l = lead({ tags: ["whatsapp-derived"], ...withSubScores({ software: 70, marketing: 70, catalogo: 70 }), ...withInferredState({}) });
    const r = computeAllBuyerScores(l).find((s) => s.buyer_type === "whatsapp_business")!;
    expect(r.score).toBeGreaterThan(0);
    expect(r.breakdown.applied_modifiers.join(",")).toContain("derived");

    const none = lead({ ...withSubScores({ software: 70 }), ...withInferredState({}) });
    const rn = computeAllBuyerScores(none).find((s) => s.buyer_type === "whatsapp_business")!;
    expect(rn.score).toBe(0);
  });
});
