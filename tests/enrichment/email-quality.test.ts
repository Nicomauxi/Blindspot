import { describe, expect, it, vi } from "vitest";
import { assessEmailQuality } from "../../src/modules/enrichment/parsers/email-quality.js";

describe("assessEmailQuality", () => {
  it("classifies generic inboxes and applies domain-match bonus", async () => {
    const resolveMx = vi.fn(async () => [{ exchange: "mx.negocio.uy", priority: 10 }]);

    const [result] = await assessEmailQuality(
      ["info@negocio.uy"],
      "Negocio Uy",
      resolveMx
    );

    expect(result).toMatchObject({
      email: "info@negocio.uy",
      quality: "generic",
      domain_match: true,
      mx_valid: true,
      reliability_multiplier: 0.55,
    });
  });

  it("classifies owner-role inboxes", async () => {
    const resolveMx = vi.fn(async () => [{ exchange: "mx.negocio.uy", priority: 10 }]);

    const [result] = await assessEmailQuality(
      ["gerencia@negocio.uy"],
      "Negocio",
      resolveMx
    );

    expect(result?.quality).toBe("role");
    expect(result?.reliability_multiplier).toBe(1.32);
  });

  it("classifies name-based inboxes as personal", async () => {
    const resolveMx = vi.fn(async () => [{ exchange: "mx.salonbella.uy", priority: 10 }]);

    const [result] = await assessEmailQuality(
      ["juan.garcia@salonbella.uy"],
      "Salon Bella",
      resolveMx
    );

    expect(result).toMatchObject({
      quality: "personal",
      domain_match: true,
      reliability_multiplier: 1.65,
    });
  });

  it("marks missing MX without crashing on repeated domains", async () => {
    const resolveMx = vi.fn(async () => {
      const error = new Error("no mx");
      Object.assign(error, { code: "ENODATA" });
      throw error;
    });

    const results = await assessEmailQuality(
      ["ventas@negocio.uy", "info@negocio.uy"],
      "Negocio",
      resolveMx
    );

    expect(results.every((result) => result.mx_valid === false)).toBe(true);
    expect(resolveMx).toHaveBeenCalledTimes(1);
  });

  it("does not penalize transient DNS failures as no-mx", async () => {
    const resolveMx = vi.fn(async () => {
      const error = new Error("timeout");
      Object.assign(error, { code: "ETIMEOUT" });
      throw error;
    });

    const [result] = await assessEmailQuality(
      ["hola@negocio.uy"],
      "Negocio",
      resolveMx
    );

    expect(result?.mx_valid).toBeNull();
  });
});
