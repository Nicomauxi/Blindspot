import { describe, expect, it } from "vitest";
import { validateDiscoveryPlaceEntry } from "../../src/storage/discovery-places.js";

describe("validateDiscoveryPlaceEntry", () => {
  const baseRow = {
    location_key: "centro-mvd",
    display_name: "Centro (Montevideo)",
    parent_location: "Montevideo",
    kind: "barrio",
    lat_approx: "-34.9058",
    lng_approx: "-56.1882",
    commercial_score: "85",
    notes: "Alta densidad comercial",
  };

  it("accepts a fully valid row", () => {
    const result = validateDiscoveryPlaceEntry(baseRow, 2);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.entry.location_key).toBe("centro-mvd");
      expect(result.entry.kind).toBe("barrio");
      expect(result.entry.lat_approx).toBeCloseTo(-34.9058);
      expect(result.entry.commercial_score).toBe(85);
    }
  });

  it("rejects missing location_key", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, location_key: "" }, 3);
    expect("error" in result).toBe(true);
  });

  it("rejects missing display_name", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, display_name: "" }, 4);
    expect("error" in result).toBe(true);
  });

  it("rejects invalid kind", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, kind: "municipio" }, 5);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("invalid kind");
  });

  it("rejects latitude outside Uruguay bounds", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, lat_approx: "-40.0" }, 6);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("lat_approx");
  });

  it("rejects longitude outside Uruguay bounds", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, lng_approx: "-60.0" }, 7);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("lng_approx");
  });

  it("rejects commercial_score outside 0-100", () => {
    const result = validateDiscoveryPlaceEntry({ ...baseRow, commercial_score: "150" }, 8);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("commercial_score");
  });

  it("accepts null/empty optional fields", () => {
    const result = validateDiscoveryPlaceEntry({
      location_key: "pando",
      display_name: "Pando",
      kind: "ciudad",
      parent_location: "",
      lat_approx: "",
      lng_approx: "",
      commercial_score: "",
      notes: "",
    }, 9);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.entry.lat_approx).toBeNull();
      expect(result.entry.lng_approx).toBeNull();
      expect(result.entry.commercial_score).toBeNull();
      expect(result.entry.parent_location).toBeNull();
      expect(result.entry.notes).toBeNull();
    }
  });

  it("accepts all valid kind values", () => {
    const kinds = ["departamento", "ciudad", "barrio", "zona_turistica", "polo_industrial", "avenida"];
    for (const kind of kinds) {
      const result = validateDiscoveryPlaceEntry({ ...baseRow, kind }, 10);
      expect("error" in result).toBe(false);
    }
  });
});
