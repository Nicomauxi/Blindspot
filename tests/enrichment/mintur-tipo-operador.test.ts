import { describe, it, expect } from "vitest";
import { parseTipoOperador } from "../../src/modules/enrichment/parsers/mintur-tipo-operador.js";

describe("parseTipoOperador", () => {
  it("returns null for null source_data", () => {
    expect(parseTipoOperador(null)).toBeNull();
  });

  it("returns null when TipoOperador field absent", () => {
    expect(parseTipoOperador({ nombre: "Hotel Central" })).toBeNull();
  });

  it("returns null when TipoOperador is empty string", () => {
    expect(parseTipoOperador({ TipoOperador: "" })).toBeNull();
  });

  it("parses Agencia de viajes Nueva → agencia_viajes", () => {
    const result = parseTipoOperador({ TipoOperador: "Agencia de viajes Nueva" });
    expect(result).not.toBeNull();
    expect(result!.tipo_operador).toBe("Agencia de viajes Nueva");
    expect(result!.tipo_operador_sub_niche).toBe("agencia_viajes");
  });

  it("parses Inmobiliaria → inmobiliaria", () => {
    const result = parseTipoOperador({ TipoOperador: "Inmobiliaria" });
    expect(result!.tipo_operador_sub_niche).toBe("inmobiliaria");
  });

  it("parses Alojamientos Turísticos → alojamiento", () => {
    const result = parseTipoOperador({ TipoOperador: "Alojamientos Turísticos" });
    expect(result!.tipo_operador_sub_niche).toBe("alojamiento");
  });

  it("parses Agencia de transportes → transporte", () => {
    const result = parseTipoOperador({ TipoOperador: "Agencia de transportes" });
    expect(result!.tipo_operador_sub_niche).toBe("transporte");
  });

  it("parses Rentadora de autos → rent_a_car", () => {
    const result = parseTipoOperador({ TipoOperador: "Rentadora de autos" });
    expect(result!.tipo_operador_sub_niche).toBe("rent_a_car");
  });

  it("parses unknown type → otro_mintur", () => {
    const result = parseTipoOperador({ TipoOperador: "Cetáceos" });
    expect(result!.tipo_operador).toBe("Cetáceos");
    expect(result!.tipo_operador_sub_niche).toBe("otro_mintur");
  });

  it("preserves original TipoOperador value with leading/trailing spaces trimmed", () => {
    const result = parseTipoOperador({ TipoOperador: "  SALAS DE CONVENCION  " });
    expect(result!.tipo_operador).toBe("SALAS DE CONVENCION");
    expect(result!.tipo_operador_sub_niche).toBe("sala_convenciones");
  });
});
