import { describe, expect, it } from "vitest";
import { computeUrgencyProfile } from "../../src/modules/scoring/urgency-profile.js";
import type { Lead } from "../../src/shared/types.js";

function lead(over: Partial<Lead>, social?: Record<string, unknown>): Lead {
  return {
    id: "x", name: "n", niche: "other", address: "Montevideo", tags: [],
    created_at: new Date().toISOString(),
    digital_footprint: social ? { social_activity: { summary: social } } : null,
    ...over,
  } as unknown as Lead;
}

describe("#1b: social activa → urgency", () => {
  it("presencia social ACTIVA lifta urgency low→medium", () => {
    const p = computeUrgencyProfile(lead({}, { active_platforms: ["instagram"], audience_tier: "medium", commercial_signals: [] }));
    expect(p.business_urgency_signal).toBe("medium");
  });

  it("sin social activa → queda low (caso base)", () => {
    expect(computeUrgencyProfile(lead({})).business_urgency_signal).toBe("low");
  });

  it("no pisa un high ya detectado (zona turística)", () => {
    const p = computeUrgencyProfile(lead(
      { niche: "restaurant", address: "Punta del Este" },
      { active_platforms: ["instagram"], commercial_signals: [] }
    ));
    expect(p.business_urgency_signal).toBe("high");
  });
});
