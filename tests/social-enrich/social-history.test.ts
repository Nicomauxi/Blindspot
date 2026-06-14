import { describe, expect, it } from "vitest";
import { deriveSocialMetrics, type SocialSnapshotPoint } from "../../src/modules/social-enrich/social-history.js";

function pt(p: Partial<SocialSnapshotPoint> & { captured_at: string }): SocialSnapshotPoint {
  return { followers: null, posts: null, likes: null, talking_about: null, activity_status: null, ...p };
}

const NOW = "2026-06-07T00:00:00Z";

describe("deriveSocialMetrics", () => {
  it("0 puntos: todo null, sin churn", () => {
    const d = deriveSocialMetrics([], { nowIso: NOW });
    expect(d.followers_growth_30d).toBeNull();
    expect(d.posts_per_month).toBeNull();
    expect(d.churn_risk).toBe(false);
    expect(d.point_count).toBe(0);
  });

  it("1 punto: tasas null pero serie con el valor puntual", () => {
    const d = deriveSocialMetrics([pt({ captured_at: NOW, followers: 1000, posts: 100 })], { nowIso: NOW });
    expect(d.followers_growth_30d).toBeNull();
    expect(d.posts_per_month).toBeNull();
    expect(d.series).toHaveLength(1);
  });

  it("2 puntos crecientes: growth abs/pct correcto", () => {
    const d = deriveSocialMetrics(
      [
        pt({ captured_at: "2026-05-08T00:00:00Z", followers: 1000 }),
        pt({ captured_at: "2026-06-07T00:00:00Z", followers: 1200 }),
      ],
      { nowIso: NOW }
    );
    expect(d.followers_growth_30d).toEqual({ abs: 200, pct: 20 });
  });

  it("posts_per_month real entre dos capturas", () => {
    const d = deriveSocialMetrics(
      [
        pt({ captured_at: "2026-05-08T00:00:00Z", posts: 100 }),
        pt({ captured_at: "2026-06-07T00:00:00Z", posts: 130 }),
      ],
      { nowIso: NOW }
    );
    // ~30 días => ~1 mes => 30 posts/mes
    expect(d.posts_per_month).toBeGreaterThan(28);
    expect(d.posts_per_month).toBeLessThan(32);
  });

  it("salta puntos con followers null (no los trata como 0)", () => {
    const d = deriveSocialMetrics(
      [
        pt({ captured_at: "2026-05-08T00:00:00Z", followers: 1000, activity_status: "active" }),
        pt({ captured_at: "2026-05-20T00:00:00Z", followers: null, activity_status: null }),
        pt({ captured_at: "2026-06-07T00:00:00Z", followers: 1100, activity_status: "active" }),
      ],
      { nowIso: NOW }
    );
    expect(d.followers_growth_30d?.abs).toBe(100);
    expect(d.churn_risk).toBe(false);
  });

  it("churn_risk: transición active -> abandoned", () => {
    const d = deriveSocialMetrics(
      [
        pt({ captured_at: "2026-04-01T00:00:00Z", activity_status: "active" }),
        pt({ captured_at: "2026-06-07T00:00:00Z", activity_status: "abandoned" }),
      ],
      { nowIso: NOW }
    );
    expect(d.churn_risk).toBe(true);
  });
});
