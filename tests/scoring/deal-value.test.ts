import { describe, expect, it } from "vitest";
import { estimateDealValue } from "../../src/modules/scoring/deal-value.js";

describe("estimateDealValue", () => {
  it("sin reviews → unknown", () => {
    expect(estimateDealValue({ review_count: null, niche: "restaurant" }).tier).toBe("unknown");
    expect(estimateDealValue({ review_count: 0, niche: "restaurant" }).tier).toBe("unknown");
  });

  it("usa el ticket del nicho (restaurant 350) y escala por reviews", () => {
    // 400 reviews × 2 órdenes × 350 = 280000 → high
    const r = estimateDealValue({ review_count: 400, niche: "restaurant" });
    expect(r.avg_ticket_uyu).toBe(350);
    expect(r.monthly_revenue_est_uyu).toBe(280000);
    expect(r.tier).toBe("high");
  });

  it("banda medium (~100 reviews restaurant = 70000)", () => {
    expect(estimateDealValue({ review_count: 100, niche: "restaurant" }).tier).toBe("medium");
  });

  it("banda low (negocio chico)", () => {
    // 30 reviews × 2 × 300 (other) = 18000 → low
    expect(estimateDealValue({ review_count: 30, niche: "other" }).tier).toBe("low");
  });

  it("nicho desconocido → ticket default 300", () => {
    expect(estimateDealValue({ review_count: 10, niche: "ferreteria" }).avg_ticket_uyu).toBe(300);
  });
});
