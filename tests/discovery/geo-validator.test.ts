import { describe, expect, it } from "vitest";
import { isWithinUruguay, inferDepartamento, isForeignAddress } from "../../src/modules/discovery/geo-validator.js";

describe("isForeignAddress (F1.3)", () => {
  it("detecta direcciones con país extranjero en el último segmento", () => {
    expect(isForeignAddress("C. 31 273, Mercedes, Provincia de Buenos Aires, Argentina")).toBe(true);
    expect(isForeignAddress("Rua X, Santana do Livramento, Brasil")).toBe(true);
    expect(isForeignAddress("Some St, Brazil")).toBe(true);
  });

  it("NO marca extranjeras direcciones uruguayas con calles 'Argentina'/'Brasil'", () => {
    // Calle llamada Argentina pero el país es Uruguay (último segmento).
    expect(isForeignAddress("Av. Argentina esq. Italia, Parque del Plata, Canelones, Uruguay")).toBe(false);
    // Calle Brasil en Montevideo, sin segmento país.
    expect(isForeignAddress("BRASIL 2524, MONTEVIDEO, MONTEVIDEO")).toBe(false);
    expect(isForeignAddress("ENTRE REPUBLICA ARGENTINA Y JOSE IGNACIO, LA JUANITA, MALDONADO")).toBe(false);
  });

  it("maneja vacío/null", () => {
    expect(isForeignAddress(null)).toBe(false);
    expect(isForeignAddress("")).toBe(false);
    expect(isForeignAddress("Montevideo")).toBe(false);
  });
});

describe("isWithinUruguay", () => {
  it("returns true for Montevideo city center coordinates", () => {
    expect(isWithinUruguay(-34.9011, -56.1645)).toBe(true);
  });

  it("returns true for Salto coordinates", () => {
    expect(isWithinUruguay(-31.3833, -57.9667)).toBe(true);
  });

  it("returns true for Punta del Este coordinates", () => {
    expect(isWithinUruguay(-34.9724, -54.9361)).toBe(true);
  });

  it("returns false for Córdoba, Argentina (clearly west of Uruguay)", () => {
    expect(isWithinUruguay(-31.4135, -64.1811)).toBe(false);
  });

  it("returns false for São Paulo (Brazil — north and east)", () => {
    expect(isWithinUruguay(-23.5505, -46.6333)).toBe(false);
  });

  it("returns false for Asunción (Paraguay — north)", () => {
    expect(isWithinUruguay(-25.2867, -57.6470)).toBe(false);
  });
});

describe("inferDepartamento", () => {
  it("infers Montevideo from GPS coordinates", () => {
    expect(inferDepartamento(-34.9011, -56.1645, "Montevideo")).toBe("Montevideo");
  });

  it("infers Maldonado from Punta del Este GPS", () => {
    expect(inferDepartamento(-34.9724, -54.9361, "Punta del Este")).toBe("Maldonado");
  });

  it("falls back to string lookup when GPS is null", () => {
    expect(inferDepartamento(null, null, "Montevideo")).toBe("Montevideo");
    expect(inferDepartamento(null, null, "Salto")).toBe("Salto");
    expect(inferDepartamento(null, null, "Punta del Este")).toBe("Maldonado");
    expect(inferDepartamento(null, null, "Melo")).toBe("Cerro Largo");
  });

  it("handles accented location strings via fallback", () => {
    expect(inferDepartamento(null, null, "Paysandú")).toBe("Paysandú");
  });

  it("returns null for unknown location when GPS is null", () => {
    expect(inferDepartamento(null, null, "Ciudad desconocida")).toBeNull();
  });

  it("returns null for out-of-Uruguay GPS (Córdoba, Argentina)", () => {
    expect(inferDepartamento(-31.4135, -64.1811, "Córdoba")).toBeNull();
  });
});
