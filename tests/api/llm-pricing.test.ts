import { afterEach, describe, expect, it } from "vitest";
import { resolveModelPricing } from "../../api/src/llm/pricing.js";

describe("resolveModelPricing (F6.1)", () => {
  afterEach(() => {
    delete process.env["LLM_COST_PER_1K_IN"];
    delete process.env["LLM_COST_PER_1K_OUT"];
  });

  it("conoce la tarifa de gemini-2.5-flash", () => {
    const p = resolveModelPricing("gemini-2.5-flash");
    expect(p.costPer1kIn).toBeGreaterThan(0);
    expect(p.costPer1kOut).toBeGreaterThan(p.costPer1kIn);
  });

  it("modelos distintos pueden tener tarifas distintas", () => {
    const flash = resolveModelPricing("gemini-2.5-flash");
    const pro = resolveModelPricing("gemini-2.5-pro");
    expect(pro.costPer1kIn).toBeGreaterThan(flash.costPer1kIn);
  });

  it("un modelo desconocido usa el fallback conservador", () => {
    const p = resolveModelPricing("modelo-inventado");
    expect(p.costPer1kIn).toBeGreaterThan(0);
  });

  it("las env vars LLM_COST_PER_1K_IN/OUT overridean la tabla", () => {
    process.env["LLM_COST_PER_1K_IN"] = "0.002";
    process.env["LLM_COST_PER_1K_OUT"] = "0.004";
    const p = resolveModelPricing("gemini-2.5-flash");
    expect(p.costPer1kIn).toBe(0.002);
    expect(p.costPer1kOut).toBe(0.004);
  });
});
