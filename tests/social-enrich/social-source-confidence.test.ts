import { describe, expect, it } from "vitest";
import { socialSourceConfidence } from "../../src/modules/social-enrich/social-source-confidence.js";

describe("socialSourceConfidence", () => {
  it("base 0.45 sin señales (unknown, sin audiencia ni recencia)", () => {
    expect(socialSourceConfidence({ activity_status: "unknown", audience_tier: null })).toBe(0.45);
  });

  it("activa + alta audiencia + reciente se acerca al techo", () => {
    const v = socialSourceConfidence({ activity_status: "active", audience_tier: "high", recency_days: 5 });
    expect(v).toBe(0.8);
  });

  it("abandonada cae al piso (<= 0.2) para no ganar conflictos", () => {
    const v = socialSourceConfidence({ activity_status: "abandoned", audience_tier: "high", recency_days: 2 });
    expect(v).toBe(0.2);
    expect(v).toBeLessThanOrEqual(0.2);
  });

  it("activa sin recencia conocida da bonus moderado", () => {
    expect(socialSourceConfidence({ activity_status: "active", audience_tier: null })).toBe(0.55);
  });

  it("activa con recencia entre 30 y 90 días premia menos", () => {
    expect(socialSourceConfidence({ activity_status: "active", audience_tier: "medium", recency_days: 60 })).toBe(0.6);
  });

  it("activa pero sin captura reciente (>90d) no premia frescura", () => {
    expect(socialSourceConfidence({ activity_status: "active", audience_tier: "low", recency_days: 400 })).toBe(0.45);
  });

  it("siempre dentro de [0.2, 0.85]", () => {
    const cases: Array<Parameters<typeof socialSourceConfidence>[0]> = [
      { activity_status: "active", audience_tier: "high", recency_days: 0 },
      { activity_status: "abandoned", audience_tier: "low", recency_days: 999 },
      { activity_status: "unknown", audience_tier: "high" },
    ];
    for (const c of cases) {
      const v = socialSourceConfidence(c);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(0.85);
    }
  });
});
