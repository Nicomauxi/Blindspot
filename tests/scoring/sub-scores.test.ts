import { describe, it, expect } from "vitest";
import { calculateSubScores } from "../../src/modules/scoring/sub-scores.js";
import type { Lead, OperationalSystemsSignal } from "../../src/shared/types.js";
import { empty_lead } from "./fixtures/leads.js";

function lead(overrides: Partial<Lead> = {}): Lead {
  return { ...empty_lead, ...overrides };
}

function emptyOps(): OperationalSystemsSignal {
  return {
    booking_platforms: [],
    reservation_platforms: [],
    delivery_platforms: [],
    menu_links: [],
    menu_keywords: [],
    class_booking_platforms: [],
    app_store_links: [],
    catalog_keywords: [],
    contact_form: false,
    chat_widget: false,
    ecommerce_platforms: [],
    whatsapp_web_link: false,
  };
}

function withOps(ops: Partial<OperationalSystemsSignal>): Lead["digital_footprint"] {
  return {
    fetched_at: "2026-01-01T00:00:00Z",
    operational_systems: { ...emptyOps(), ...ops },
  };
}

// ─── score_web_nuevo ────────────────────────────────────────────────────────

describe("score_web_nuevo", () => {
  it("no tags → 0", () => {
    expect(calculateSubScores(lead(), 0).web_nuevo).toBe(0);
  });

  it("no-website → 35", () => {
    expect(calculateSubScores(lead({ tags: ["no-website"] }), 0).web_nuevo).toBe(35);
  });

  it("high-reviews-no-web stacks +10", () => {
    expect(calculateSubScores(lead({ tags: ["no-website", "high-reviews-no-web"] }), 0).web_nuevo).toBe(45);
  });

  it("fb-only-presence adds +15", () => {
    expect(calculateSubScores(lead({ tags: ["no-website", "fb-only-presence"] }), 0).web_nuevo).toBe(50);
  });

  it("ig-only-presence adds +15", () => {
    expect(calculateSubScores(lead({ tags: ["no-website", "ig-only-presence"] }), 0).web_nuevo).toBe(50);
  });

  it("social-link-only adds +15", () => {
    expect(calculateSubScores(lead({ tags: ["no-website", "social-link-only"] }), 0).web_nuevo).toBe(50);
  });

  it("multiple social tags count only +15 (not stacked)", () => {
    const result = calculateSubScores(
      lead({ tags: ["no-website", "fb-only-presence", "ig-only-presence"] }),
      0
    );
    expect(result.web_nuevo).toBe(50); // 35+15, not 35+15+15
  });

  it("max possible: no-website + high-reviews-no-web + fb-only → 60", () => {
    expect(
      calculateSubScores(
        lead({ tags: ["no-website", "high-reviews-no-web", "fb-only-presence"] }),
        0
      ).web_nuevo
    ).toBe(60);
  });
});

// ─── score_rediseno ─────────────────────────────────────────────────────────

describe("score_rediseno", () => {
  it("no web → 0 regardless of signal tags", () => {
    expect(calculateSubScores(lead({ tags: ["ssl-missing", "not-responsive"] }), 0).rediseno).toBe(0);
  });

  it("website field present enables rediseno", () => {
    expect(
      calculateSubScores(lead({ website: "https://example.com.uy", tags: ["ssl-missing"] }), 0).rediseno
    ).toBe(10);
  });

  it("website-heuristic tag enables rediseno", () => {
    expect(
      calculateSubScores(lead({ tags: ["website-heuristic", "not-responsive"] }), 0).rediseno
    ).toBe(10);
  });

  it("web-only-no-social tag enables rediseno", () => {
    expect(
      calculateSubScores(lead({ tags: ["web-only-no-social", "ssl-missing"] }), 0).rediseno
    ).toBe(10);
  });

  it("all rediseno tags sum correctly", () => {
    const result = calculateSubScores(
      lead({
        website: "https://old.example.com.uy",
        tags: ["site-unreachable", "ssl-missing", "not-responsive", "stack-obsolete", "web-outdated", "domain-old-stale"],
      }),
      0
    );
    expect(result.rediseno).toBe(58); // 15+10+10+10+8+5
  });

  it("web present but no signal tags → 0", () => {
    expect(
      calculateSubScores(lead({ website: "https://example.com.uy", tags: [] }), 0).rediseno
    ).toBe(0);
  });
});

// ─── score_marketing ────────────────────────────────────────────────────────

describe("score_marketing", () => {
  it("no tags → 0", () => {
    expect(calculateSubScores(lead(), 0).marketing).toBe(0);
  });

  it("web-only-no-social → 28", () => {
    expect(calculateSubScores(lead({ tags: ["web-only-no-social"] }), 0).marketing).toBe(28);
  });

  it("fb-heuristic adds +15 when no fb-confirmed or fb-only", () => {
    expect(calculateSubScores(lead({ tags: ["fb-heuristic"] }), 0).marketing).toBe(15);
  });

  it("fb-heuristic suppressed by fb-confirmed", () => {
    expect(calculateSubScores(lead({ tags: ["fb-heuristic", "fb-confirmed"] }), 0).marketing).toBe(0);
  });

  it("fb-heuristic suppressed by fb-only-presence", () => {
    expect(calculateSubScores(lead({ tags: ["fb-heuristic", "fb-only-presence"] }), 0).marketing).toBe(0);
  });

  it("ig-heuristic adds +15 when no ig-confirmed or ig-only", () => {
    expect(calculateSubScores(lead({ tags: ["ig-heuristic"] }), 0).marketing).toBe(15);
  });

  it("ig-heuristic suppressed by ig-confirmed", () => {
    expect(calculateSubScores(lead({ tags: ["ig-heuristic", "ig-confirmed"] }), 0).marketing).toBe(0);
  });

  it("pixel-missing + analytics-missing → 10", () => {
    expect(
      calculateSubScores(lead({ tags: ["pixel-missing", "analytics-missing"] }), 0).marketing
    ).toBe(10);
  });

  it("all signals stack: web-only-no-social + fb + ig + pixel + analytics → 68", () => {
    const result = calculateSubScores(
      lead({ tags: ["web-only-no-social", "fb-heuristic", "ig-heuristic", "pixel-missing", "analytics-missing"] }),
      0
    );
    expect(result.marketing).toBe(68); // 28+15+15+5+5
  });
});

// ─── score_software ─────────────────────────────────────────────────────────

describe("score_software", () => {
  it("sgScore=0, no tags → 0", () => {
    expect(calculateSubScores(lead(), 0).software).toBe(0);
  });

  it("sgScore=50 passes through", () => {
    expect(calculateSubScores(lead(), 50).software).toBe(50);
  });

  it("whatsapp-missing adds +10", () => {
    expect(calculateSubScores(lead({ tags: ["whatsapp-missing"] }), 0).software).toBe(10);
  });

  it("chat-widget-missing adds +3", () => {
    expect(calculateSubScores(lead({ tags: ["chat-widget-missing"] }), 0).software).toBe(3);
  });

  it("sgScore + whatsapp + chat stack", () => {
    expect(calculateSubScores(lead({ tags: ["whatsapp-missing", "chat-widget-missing"] }), 30).software).toBe(43);
  });

  it("capped at 100", () => {
    expect(calculateSubScores(lead({ tags: ["whatsapp-missing", "chat-widget-missing"] }), 95).software).toBe(100);
  });

  it("reads inferred_state from top-level lead column", () => {
    const result = calculateSubScores(
      lead({
        inferred_state: {
          has_reservations: { value: true, confidence: 0.9, via: [] },
          has_delivery: { value: false, confidence: 0.9, via: [] },
          has_ecommerce: { value: false, confidence: 0.9, via: [] },
          has_online_catalog: { value: false, confidence: 0.9, via: [] },
          has_pos: { value: false, confidence: 0.9, via: [] },
          has_chat_support: { value: false, confidence: 0.9, via: [] },
          digitalization_level: "basic",
          computed_at: "2026-01-01T00:00:00Z",
        },
      }),
      50
    );
    expect(result.software).toBe(35);
  });
});

// ─── score_catalogo ─────────────────────────────────────────────────────────

describe("score_catalogo", () => {
  it("no footprint → 0 (can't infer absences without ops data)", () => {
    expect(calculateSubScores(lead({ niche: "restaurant" }), 0).catalogo).toBe(0);
  });

  it("skipped footprint → 0", () => {
    const l = lead({
      niche: "restaurant",
      digital_footprint: { skipped: true, reason: "no-website", fetched_at: "2026-01-01T00:00:00Z" },
    });
    expect(calculateSubScores(l, 0).catalogo).toBe(0);
  });

  it("hours-missing-on-web tag adds +3 even without ops (rubro con catálogo)", () => {
    expect(calculateSubScores(lead({ niche: "grocery", tags: ["hours-missing-on-web"] }), 0).catalogo).toBe(3);
  });

  it("restaurant with all missing ops → 60 (ecommerce+menu_links+menu_keywords)", () => {
    const l = lead({ niche: "restaurant", digital_footprint: withOps({}) });
    expect(calculateSubScores(l, 0).catalogo).toBe(60); // 25+20+15
  });

  it("car_dealer with all missing ops → 45 (ecommerce+menu_links+catalog_keywords)", () => {
    const l = lead({ niche: "car_dealer", digital_footprint: withOps({}) });
    expect(calculateSubScores(l, 0).catalogo).toBe(60); // 25+20+15
  });

  it("restaurant with ecommerce present reduces score", () => {
    const l = lead({
      niche: "restaurant",
      digital_footprint: withOps({ ecommerce_platforms: ["shopify"] }),
    });
    expect(calculateSubScores(l, 0).catalogo).toBe(35); // 20+15 (no ecommerce bonus)
  });

  it("restaurant with menu_links present reduces score", () => {
    const l = lead({
      niche: "restaurant",
      digital_footprint: withOps({ menu_links: ["https://menu.example.com/menu.pdf"] }),
    });
    expect(calculateSubScores(l, 0).catalogo).toBe(40); // 25+15
  });

  it("restaurant with menu_keywords present reduces score", () => {
    const l = lead({
      niche: "restaurant",
      digital_footprint: withOps({ menu_keywords: ["carta", "menú"] }),
    });
    expect(calculateSubScores(l, 0).catalogo).toBe(45); // 25+20
  });

  it("F3.5: rubro de servicio (gym) → catalogo 0 (no aplica catálogo/ecommerce)", () => {
    const l = lead({ niche: "gym", digital_footprint: withOps({}) });
    expect(calculateSubScores(l, 0).catalogo).toBe(0);
  });

  it("F3.5: niche 'other' → catalogo 0 (no se puede confirmar rubro de producto)", () => {
    const l = lead({ niche: "other", digital_footprint: withOps({}) });
    expect(calculateSubScores(l, 0).catalogo).toBe(0);
  });

  it("rubro de comercio (grocery) sin ops de catálogo → 45 (25+20)", () => {
    const l = lead({ niche: "grocery", digital_footprint: withOps({}) });
    expect(calculateSubScores(l, 0).catalogo).toBe(45);
  });

  it("hours-missing-on-web + restaurant all missing → 63", () => {
    const l = lead({
      niche: "restaurant",
      tags: ["hours-missing-on-web"],
      digital_footprint: withOps({}),
    });
    expect(calculateSubScores(l, 0).catalogo).toBe(63); // 3+25+20+15
  });
});

// ─── primary_offer ──────────────────────────────────────────────────────────

describe("primary_offer", () => {
  it("all zero → none", () => {
    expect(calculateSubScores(lead(), 0).primary_offer).toBe("none");
  });

  it("web_nuevo is highest → web_nuevo", () => {
    const result = calculateSubScores(lead({ tags: ["no-website"] }), 0);
    expect(result.primary_offer).toBe("web_nuevo");
  });

  it("rediseno is highest → rediseno", () => {
    // site-unreachable(15) + ssl(10) > web_nuevo=0, marketing=0, etc.
    const result = calculateSubScores(
      lead({ website: "https://old.com.uy", tags: ["site-unreachable", "ssl-missing"] }),
      0
    );
    expect(result.primary_offer).toBe("rediseno");
  });

  it("marketing is highest → marketing", () => {
    const result = calculateSubScores(lead({ tags: ["web-only-no-social"] }), 0);
    expect(result.primary_offer).toBe("marketing");
  });

  it("software is highest via sgScore → software", () => {
    const result = calculateSubScores(lead(), 80);
    expect(result.primary_offer).toBe("software");
  });

  it("tiebreak: first offer in order wins (web_nuevo before rediseno)", () => {
    // Both web_nuevo and rediseno = 15
    const result = calculateSubScores(
      lead({ website: "https://old.com.uy", tags: ["site-unreachable", "high-reviews-no-web"] }),
      0
    );
    // web_nuevo: high-reviews-no-web=10 (no no-website) → 10
    // rediseno: site-unreachable=15
    // rediseno wins since 15 > 10
    expect(result.primary_offer).toBe("rediseno");
  });
});

// ─── integration ────────────────────────────────────────────────────────────

describe("calculateSubScores — integration", () => {
  it("returns all five scores + primary_offer", () => {
    const result = calculateSubScores(lead({ tags: ["no-website", "whatsapp-missing"] }), 0);
    expect(typeof result.web_nuevo).toBe("number");
    expect(typeof result.rediseno).toBe("number");
    expect(typeof result.marketing).toBe("number");
    expect(typeof result.software).toBe("number");
    expect(typeof result.catalogo).toBe("number");
    expect(typeof result.primary_offer).toBe("string");
  });

  it("idempotent: same lead → same result on two calls", () => {
    const l = lead({ tags: ["no-website", "pixel-missing", "whatsapp-missing"] });
    const first = calculateSubScores(l, 20);
    const second = calculateSubScores(l, 20);
    expect(second).toEqual(first);
  });

  it("sgScore=0 and empty tags → all zeros, primary_offer=none", () => {
    const result = calculateSubScores(lead(), 0);
    expect(result).toEqual({
      web_nuevo: 0,
      rediseno: 0,
      marketing: 0,
      software: 0,
      catalogo: 0,
      contacto_directo: 0,
      primary_offer: "none",
    });
  });
});
