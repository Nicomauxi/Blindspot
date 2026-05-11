import { describe, expect, it } from "vitest";
import {
  applyGeographicPenalties,
  hasForeignGeoText,
  hasForeignPhonePrefix,
  hasForeignTld,
} from "../../src/modules/social-enrich/geo-penalty.js";

describe("geo-penalty", () => {
  it("detects foreign TLDs while allowing Uruguay and generic domains", () => {
    expect(hasForeignTld("https://negocio.mx")).toBe(true);
    expect(hasForeignTld("negocio.com.uy")).toBe(false);
    expect(hasForeignTld("https://negocio.uy")).toBe(false);
    expect(hasForeignTld("https://negocio.com")).toBe(false);
  });

  it("uses custom foreign TLDs when provided", () => {
    const ctx = { foreignTlds: new Set(["custom"]) };

    expect(hasForeignTld("https://negocio.custom", ctx)).toBe(true);
    expect(hasForeignTld("https://negocio.com.uy", ctx)).toBe(false);
  });

  it("keeps default detection when ctx is omitted", () => {
    expect(hasForeignTld("https://negocio.mx")).toBe(true);
    expect(hasForeignGeoText("Sucursal en México")).toBe(true);
    expect(hasForeignPhonePrefix("+52 238 123 4567")).toBe(true);
    expect(
      applyGeographicPenalties(0.95, {
        website: "https://negocio.mx",
        description: "Local en Montevideo, Uruguay",
        phone: "+598 99 123 456",
      })
    ).toBe(0.65);
  });

  it("detects foreign geographic text", () => {
    expect(hasForeignGeoText("Sucursal en Tehuacán, México")).toBe(true);
    expect(hasForeignGeoText("Local en Montevideo, Uruguay")).toBe(false);
  });

  it("detects foreign phone prefixes", () => {
    expect(hasForeignPhonePrefix("+52 238 123 4567")).toBe(true);
    expect(hasForeignPhonePrefix("0054 11 1234 5678")).toBe(true);
    expect(hasForeignPhonePrefix("+598 99 123 456")).toBe(false);
    expect(hasForeignPhonePrefix("099123456")).toBe(false);
  });

  it("applies accumulated penalties with a zero floor", () => {
    expect(
      applyGeographicPenalties(0.95, {
        website: "https://negocio.mx",
        description: "Sucursal en Tehuacán, México",
        phone: "+52 238 123 4567",
      })
    ).toBe(0);
    expect(
      applyGeographicPenalties(0.95, {
        website: "https://negocio.mx",
        description: "Local en Montevideo, Uruguay",
        phone: "+598 99 123 456",
      })
    ).toBe(0.65);
  });
});
