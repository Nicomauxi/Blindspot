import { describe, expect, it } from "vitest";
import {
  extractAddressCity,
  haversineMeters,
  normalizeAddress,
  parseLeadGps,
  parseEwkbHexPoint,
} from "../../src/modules/discovery/geo-text.js";
import { EWKB_POINT_PAYSANDU, POINT_TEXT_PAYSANDU, GPS_EPSILON } from "./fixtures/gps-ewkb.js";

describe("extractAddressCity", () => {
  it("extrae la ciudad de una dirección de Google ignorando país y departamento", () => {
    expect(
      extractAddressCity("Av. Brasil 895, 40000 Rivera, Departamento de Rivera, Uruguay")
    ).toBe("rivera");
    expect(
      extractAddressCity("Félix Buxareo 1158, 11300 Montevideo, Departamento de Montevideo, Uruguay")
    ).toBe("montevideo");
  });

  it("extrae la ciudad de mintur (CIUDAD, DEPARTAMENTO en mayúsculas)", () => {
    expect(extractAddressCity("CAMINO GENERAL HORNOS 4997, MONTEVIDEO, MONTEVIDEO")).toBe("montevideo");
    expect(extractAddressCity("DR. EMILIO FRUGONI S/N, MALDONADO, MALDONADO")).toBe("maldonado");
  });

  it("extrae la ciudad de yelu (… , ciudad, Uruguay)", () => {
    expect(extractAddressCity("Altarmiarno 3241, Montevideo, Uruguay")).toBe("montevideo");
    expect(
      extractAddressCity("Williman 597, Punta Carretas, Montevideo, Montevideo, Uruguay")
    ).toBe("montevideo");
  });

  it("hace que google y mintur de la misma ciudad sean comparables (era el bug)", () => {
    const google = extractAddressCity("Bvar. Francisco Mata 211, 37000 Melo, Departamento de Cerro Largo, Uruguay");
    const mintur = extractAddressCity("CALLE PRINCIPAL 100, MELO, CERRO LARGO");
    expect(google).toBe("melo");
    expect(mintur).toBe("melo");
    expect(google).toBe(mintur);
  });

  it("desambigua el patrón mintur CIUDAD, DEPARTAMENTO (último segmento = departamento)", () => {
    // "cerro largo" es departamento; la ciudad es "melo"
    expect(extractAddressCity("CALLE PRINCIPAL 100, MELO, CERRO LARGO")).toBe("melo");
    // cuando ciudad y departamento coinciden (capital), el resultado es estable
    expect(extractAddressCity("CHARRUA 1163, MONTEVIDEO, MONTEVIDEO")).toBe("montevideo");
  });

  it("no confunde la ciudad con un departamento cuando el segmento previo es una calle", () => {
    // último = montevideo (también nombre de depto) pero el previo es calle → no lo trata como depto
    expect(extractAddressCity("Altarmiarno 3241, Montevideo, Uruguay")).toBe("montevideo");
  });

  it("no devuelve un fragmento de calle como ciudad (un solo segmento)", () => {
    // sin palabra clave de ciudad conocida → null en vez de "18 de julio"
    expect(extractAddressCity("Avenida 18 de Julio 1234")).toBeNull();
  });

  it("devuelve null para dirección vacía", () => {
    expect(extractAddressCity(null)).toBeNull();
    expect(extractAddressCity("")).toBeNull();
  });
});

describe("normalizeAddress", () => {
  it("normaliza acentos, abreviaturas de vía y espacios", () => {
    expect(normalizeAddress("Av. Brasil 895")).toBe("brasil 895");
  });
});

describe("parseLeadGps", () => {
  it("parsea WKT POINT(lng lat)", () => {
    expect(parseLeadGps("POINT(-56.1645 -34.9011)")).toEqual({ lng: -56.1645, lat: -34.9011 });
  });
  it("parsea GeoJSON coordinates [lng, lat]", () => {
    expect(parseLeadGps({ coordinates: [-56.1645, -34.9011] })).toEqual({ lng: -56.1645, lat: -34.9011 });
  });
  it("devuelve null si no hay gps", () => {
    expect(parseLeadGps(null)).toBeNull();
  });
  it("rechaza coordenadas fuera de rango o no finitas", () => {
    expect(parseLeadGps({ lat: 999, lng: -56 })).toBeNull();
    expect(parseLeadGps({ lat: -34.9, lng: 999 })).toBeNull();
    expect(parseLeadGps({ coordinates: [Infinity, -34.9] })).toBeNull();
  });

  it("F2.1: parsea EWKB hex real de la DB", () => {
    const got = parseLeadGps(EWKB_POINT_PAYSANDU.hex);
    expect(got).not.toBeNull();
    expect(got!.lng).toBeCloseTo(EWKB_POINT_PAYSANDU.expected.lng, 6);
    expect(got!.lat).toBeCloseTo(EWKB_POINT_PAYSANDU.expected.lat, 6);
  });

  it("F2.1: sigue soportando WKT POINT (regresión)", () => {
    expect(parseLeadGps(POINT_TEXT_PAYSANDU.text)).toEqual(POINT_TEXT_PAYSANDU.expected);
  });
});

describe("parseEwkbHexPoint (F2.1)", () => {
  it("decodifica el Point EWKB LE con SRID 4326", () => {
    const got = parseEwkbHexPoint(EWKB_POINT_PAYSANDU.hex);
    expect(got).not.toBeNull();
    expect(Math.abs(got!.lng - EWKB_POINT_PAYSANDU.expected.lng)).toBeLessThan(GPS_EPSILON);
    expect(Math.abs(got!.lat - EWKB_POINT_PAYSANDU.expected.lat)).toBeLessThan(GPS_EPSILON);
  });
  it("rechaza hex inválido / no-Point", () => {
    expect(parseEwkbHexPoint("zzzz")).toBeNull();
    expect(parseEwkbHexPoint("0101")).toBeNull();
    expect(parseEwkbHexPoint("")).toBeNull();
  });
});

describe("haversineMeters", () => {
  it("calcula ~0 para el mismo punto", () => {
    expect(haversineMeters({ lat: -34.9, lng: -56.16 }, { lat: -34.9, lng: -56.16 })).toBeCloseTo(0, 1);
  });
  it("calcula distancia positiva entre puntos distintos", () => {
    const d = haversineMeters({ lat: -34.9, lng: -56.16 }, { lat: -34.905, lng: -56.16 });
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(600);
  });
});
