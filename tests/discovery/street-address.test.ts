import { describe, it, expect } from "vitest";
import { parseStreetAddress, streetAddressesMatch } from "../../src/modules/discovery/street-address.js";

describe("parseStreetAddress", () => {
  it("extrae puerta de 1-4 dígitos y tokens de calle, descartando el número de puerta", () => {
    const p = parseStreetAddress("Rivera 784, SALTO, SALTO");
    expect(p.door).toBe("784");
    expect(p.streetTokens).toEqual(["rivera"]);
    expect(p.hasPluscode).toBe(false);
  });

  it("ignora el código postal de 5 dígitos como puerta", () => {
    const p = parseStreetAddress("Gral. Fructuoso Rivera 784, 50000 Salto, Departamento de Salto, Uruguay");
    expect(p.door).toBe("784");
    // honorífico 'gral' descartado; queda el nombre propio completo
    expect(p.streetTokens).toEqual(["fructuoso", "rivera"]);
  });

  it("descarta tipos de vía abreviados y completos (Av. ↔ Avenida)", () => {
    expect(parseStreetAddress("Av. Luis Alberto de Herrera 1144").streetTokens).toEqual(["luis", "alberto", "herrera"]);
    expect(parseStreetAddress("Avenida Luis Alberto de Herrera, 1144").streetTokens).toEqual(["luis", "alberto", "herrera"]);
  });

  it("conserva el número inicial de un nombre tipo fecha (18 de Julio) y toma el último como puerta", () => {
    const p = parseStreetAddress("18 de Julio 478, 20000 Maldonado, Departamento de Maldonado, Uruguay");
    expect(p.door).toBe("478");
    expect(p.streetTokens).toEqual(["18", "julio"]);
  });

  it("no toma el número de un nombre tipo fecha como puerta cuando no hay otro número", () => {
    const p = parseStreetAddress("Avenida 8 de Octubre, Montevideo");
    expect(p.door).toBeNull();
    expect(p.streetTokens).toContain("octubre");
  });

  it("toma la puerta aunque esté en un segmento separado por coma (Orinoco, 4943)", () => {
    const p = parseStreetAddress("Orinoco, 4943, Montevideo");
    expect(p.door).toBe("4943");
    expect(p.streetTokens).toEqual(["orinoco"]);
  });

  it("detecta plus-codes de Google y no produce calle usable", () => {
    const p = parseStreetAddress("3385+5X5, 20100 Punta del Este, Maldonado Department, Uruguay");
    expect(p.hasPluscode).toBe(true);
  });

  it("conserva nombres propios con San/Santo (no son honoríficos)", () => {
    const p = parseStreetAddress("Gral. San Martín 1200, Montevideo");
    expect(p.streetTokens).toEqual(["san", "martin"]);
    expect(p.door).toBe("1200");
  });

  it("devuelve vacío para entrada nula", () => {
    expect(parseStreetAddress(null)).toEqual({ streetTokens: [], door: null, hasPluscode: false });
  });
});

describe("streetAddressesMatch", () => {
  const parse = parseStreetAddress;

  it("matchea abreviación de prócer: Rivera ↔ Gral. Fructuoso Rivera (misma puerta)", () => {
    const a = parse("Rivera 784, SALTO, SALTO");
    const b = parse("Gral. Fructuoso Rivera 784, 50000 Salto, Departamento de Salto, Uruguay");
    expect(streetAddressesMatch(a, b)).toBe(true);
  });

  it("matchea Artigas ↔ Gral. José Gervasio Artigas (subset, misma puerta)", () => {
    const a = parse("Artigas 725, Florida");
    const b = parse("Gral. Jose Gervasio Artigas 725, Florida");
    expect(streetAddressesMatch(a, b)).toBe(true);
  });

  it("matchea Av. ↔ Avenida con misma puerta", () => {
    const a = parse("Av. Luis Alberto de Herrera 1144, Montevideo");
    const b = parse("Avenida Luis Alberto de Herrera, 1144, Montevideo");
    expect(streetAddressesMatch(a, b)).toBe(true);
  });

  it("matchea por subset aunque solo un lado tenga puerta (Herrera 1290 ↔ Av. L.A. de Herrera)", () => {
    const a = parse("Av. Luis Alberto de Herrera 1290, Montevideo");
    const b = parse("Avenida Luis Alberto de Herrera, Montevideo");
    expect(streetAddressesMatch(a, b)).toBe(true);
  });

  it("NO matchea calles distintas con misma puerta (Rivera 784 ↔ Mercedes 784)", () => {
    const a = parse("Rivera 784, Salto");
    const b = parse("Mercedes 784, Salto");
    expect(streetAddressesMatch(a, b)).toBe(false);
  });

  it("NO matchea calles distintas (Soriano ↔ Constituyente)", () => {
    const a = parse("Soriano 1350, Montevideo");
    const b = parse("Constituyente 1527, Montevideo");
    expect(streetAddressesMatch(a, b)).toBe(false);
  });

  it("NO matchea cuando un lado es plus-code (sin calle usable)", () => {
    const a = parse("3385+5X5, Punta del Este");
    const b = parse("Av. Roosevelt 100, Punta del Este");
    expect(streetAddressesMatch(a, b)).toBe(false);
  });

  it("NO matchea cuando no hay token significativo compartido", () => {
    const a = parse("Calle 8, Montevideo");
    const b = parse("Calle 9, Montevideo");
    expect(streetAddressesMatch(a, b)).toBe(false);
  });
});
