import { describe, expect, it } from "vitest";
import { computeSocialSignal, computeSocialBonus } from "../../src/modules/scoring/social-signal.js";
import type { Lead } from "../../src/shared/types.js";
import type { SocialScoringConfig } from "../../src/modules/scoring/types.js";

const CONFIG: SocialScoringConfig = {
  audience_bonus: { low: 1, medium: 3, high: 6 },
  active_bonus: 2,
  high_audience_no_web_bonus: 4,
};

function leadWithSocial(summary: Record<string, unknown> | null): Lead {
  return {
    id: "x", name: "n", tags: [],
    digital_footprint: summary ? { social_activity: { summary } } : null,
  } as unknown as Lead;
}

describe("computeSocialSignal", () => {
  it("lee audience_tier, actividad y audiencia-sin-web del social_activity", () => {
    const s = computeSocialSignal(leadWithSocial({
      has_social_presence: true,
      audience_tier: "high",
      active_platforms: ["instagram"],
      commercial_signals: ["alta_audiencia", "alta_audiencia_sin_web"],
    }));
    expect(s).toEqual({ has_presence: true, audience_tier: "high", active: true, high_audience_no_web: true });
  });

  it("sin social_activity → señal vacía", () => {
    expect(computeSocialSignal(leadWithSocial(null))).toEqual({
      has_presence: false, audience_tier: null, active: false, high_audience_no_web: false,
    });
  });

  it("audience_tier inválido → null (defensivo)", () => {
    expect(computeSocialSignal(leadWithSocial({ audience_tier: "mega" })).audience_tier).toBeNull();
  });
});

describe("computeSocialBonus", () => {
  it("suma audiencia + actividad + audiencia-sin-web", () => {
    const bonus = computeSocialBonus(
      { has_presence: true, audience_tier: "high", active: true, high_audience_no_web: true },
      CONFIG
    );
    expect(bonus).toBe(6 + 2 + 4); // 12
  });

  it("audiencia media activa", () => {
    expect(computeSocialBonus({ has_presence: true, audience_tier: "medium", active: true, high_audience_no_web: false }, CONFIG)).toBe(5);
  });

  it("sin señal → 0", () => {
    expect(computeSocialBonus({ has_presence: false, audience_tier: null, active: false, high_audience_no_web: false }, CONFIG)).toBe(0);
  });

  it("sin config → 0 (escenario sin sección social)", () => {
    expect(computeSocialBonus({ has_presence: true, audience_tier: "high", active: true, high_audience_no_web: true }, undefined)).toBe(0);
  });
});
