import { describe, expect, it } from "vitest";
import { getSubAreas } from "../../src/modules/discovery/location-subdivider.js";

describe("getSubAreas", () => {
  it("returns sub-areas for Montevideo (exact match)", () => {
    const areas = getSubAreas("Montevideo");
    expect(areas.length).toBeGreaterThan(5);
    expect(areas.every((a) => a.includes("Montevideo"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(getSubAreas("montevideo")).toEqual(getSubAreas("Montevideo"));
    expect(getSubAreas("MONTEVIDEO")).toEqual(getSubAreas("Montevideo"));
  });

  it("strips department suffix (e.g. 'Montevideo, Uruguay')", () => {
    const areas = getSubAreas("Montevideo, Uruguay");
    expect(areas.length).toBeGreaterThan(0);
    expect(areas).toEqual(getSubAreas("Montevideo"));
  });

  it("handles accented characters ('Paysandú')", () => {
    const areas = getSubAreas("Paysandú");
    expect(areas.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown location", () => {
    expect(getSubAreas("Nowhere City")).toEqual([]);
  });

  it("returns sub-areas for Maldonado", () => {
    const areas = getSubAreas("Maldonado");
    expect(areas).toContain("Punta del Este, Maldonado");
  });
});
