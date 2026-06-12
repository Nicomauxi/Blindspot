import { describe, expect, it } from "vitest";
import { stableBusinessId } from "../../src/modules/discovery/stable-id.js";
import { mapRecord as mapMintur, type MINTURRecord } from "../../src/modules/discovery/providers/mintur.js";
import { mapRecord as mapDei, type DEIRecord } from "../../src/modules/discovery/providers/dei.js";

describe("stableBusinessId (N8.2)", () => {
  it("es determinístico e insensible a mayúsculas/tildes/espacios", () => {
    const a = stableBusinessId(["MULTICAR Rent a Car", "Av. Italia 1234", "Montevideo"]);
    const b = stableBusinessId(["multicar rent a car", " av. italia 1234 ", "MONTEVIDEO"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("distingue establecimientos distintos", () => {
    const a = stableBusinessId(["Multicar", "Av. Italia 1234", "Montevideo"]);
    const b = stableBusinessId(["Multicar", "Rambla 500", "Punta del Este"]);
    expect(a).not.toBe(b);
  });
});

describe("N82: MINTUR external_id estable (no el _id volátil de CKAN)", () => {
  const record = {
    _id: 375,
    Operador: "MULTICAR RENT A CAR",
    Direccion: "Av. Italia 1234",
    Localidad: "Montevideo",
    Departamento: "Montevideo",
    Telefono: "24001234",
    Web: "",
    EMail: "",
  } as unknown as MINTURRecord;

  it("el mismo negocio con _id distinto da el MISMO external_id", () => {
    const a = mapMintur(record);
    const b = mapMintur({ ...record, _id: 9999 } as MINTURRecord);
    expect(a.external_id).toBe(b.external_id);
    expect(a.external_id).not.toBe("375");
  });
});

describe("N86: DEI external_id = RUT + discriminador de establecimiento", () => {
  const base = {
    _id: 1,
    "Estado de la empresa": "Aprobado",
    RUT: "210123450019",
    "Denominacion Social": "EMPRESA SA",
    "Nombre comercial": "Sucursal",
    "Descripcion de la Actividad": "Panadería",
    "Codigo CIIU principal": "1071",
    "Descripcion Codigo CIIU principal": "Elaboración de pan",
    "Calle (EP)": "18 de Julio",
    "Numero (EP)": "1234",
    "Localidad (EP)": "Montevideo",
    "Departamento (EP)": "MONTEVIDEO",
    "Codigo Postal (EP)": "11200",
    "Email publico": "",
    "Sitio web": "",
    "Numero de telefono": "24001234",
  } as unknown as DEIRecord;

  it("dos establecimientos del mismo RUT NO colapsan", () => {
    const a = mapDei(base);
    const b = mapDei({ ...base, "Calle (EP)": "Rivera", "Numero (EP)": "999", "Localidad (EP)": "Salto" } as DEIRecord);
    expect(a.external_id).not.toBe(b.external_id);
    expect(a.external_id.startsWith("210123450019#")).toBe(true);
  });
});
