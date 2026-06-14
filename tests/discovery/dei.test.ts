import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DEIRecord } from "../../src/modules/discovery/providers/dei.js";
import {
  isBlank,
  parsePhone,
  shouldDiscard,
  inferNiche,
  mapRecord,
  DEIProvider,
} from "../../src/modules/discovery/providers/dei.js";

vi.mock("undici", () => ({
  Agent: class MockAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}));

import { fetch } from "undici";
const mockFetch = fetch as ReturnType<typeof vi.fn>;

function makeCKANResponse(records: DEIRecord[], total?: number) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ result: { total: total ?? records.length, records } }),
  };
}

function makeRecord(overrides: Partial<DEIRecord> = {}): DEIRecord {
  return {
    _id: 1,
    "Estado de la empresa": "Aprobado",
    RUT: "217231960015",
    "Denominacion Social": "ANFANG S. R. L.",
    "Nombre comercial": "CULTO",
    "Descripcion de la Actividad": "Importación tostado y comercialización de café de especialidad",
    "Codigo CIIU principal": "10799",
    "Descripcion Codigo CIIU principal": "Elaboración de otros productos alimenticios n.c.p.",
    "Calle (EP)": "canelones",
    "Numero (EP)": "2154",
    "Localidad (EP)": "MONTEVIDEO",
    "Departamento (EP)": "MONTEVIDEO",
    "Codigo Postal (EP)": "11000",
    "Email publico": "admin@cultocafe.uy",
    "Sitio web": "S/D",
    "Numero de telefono": "094974477",
    ...overrides,
  };
}

const BASE_QUERY = { niche: "other" as const, location: "Montevideo" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isBlank", () => {
  it("trata S/D, S/N, vacío y null como vacío", () => {
    expect(isBlank("S/D")).toBe(true);
    expect(isBlank("s/d")).toBe(true);
    expect(isBlank("S/N")).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank("admin@cultocafe.uy")).toBe(false);
  });
});

describe("parsePhone", () => {
  it("devuelve el primer teléfono no vacío y null para S/D", () => {
    expect(parsePhone("094974477")).toBe("094974477");
    expect(parsePhone("S/D")).toBeNull();
    expect(parsePhone("094974477 / 29001234")).toBe("094974477");
  });
});

describe("shouldDiscard", () => {
  it("descarta no aprobados", () => {
    expect(shouldDiscard(makeRecord({ "Estado de la empresa": "Pendiente" }))).toBe(true);
  });
  it("descarta sin razón social ni nombre comercial", () => {
    expect(shouldDiscard(makeRecord({ "Nombre comercial": "S/D", "Denominacion Social": "" }))).toBe(true);
  });
  it("conserva aprobados con nombre aunque no tengan contacto", () => {
    expect(shouldDiscard(makeRecord({ "Email publico": "S/D", "Sitio web": "S/D", "Numero de telefono": "S/D" }))).toBe(false);
  });
});

describe("inferNiche", () => {
  it("infiere el niche desde la descripción CIIU/actividad", () => {
    const niche = inferNiche(makeRecord());
    expect(typeof niche).toBe("string");
    expect(niche.length).toBeGreaterThan(0);
  });
});

describe("mapRecord", () => {
  it("mapea a DiscoveryCandidate: RUT#establecimiento como external_id, nombre comercial, contacto, sin GPS", () => {
    const c = mapRecord(makeRecord());
    expect(c.source).toBe("miem_dei");
    // N86: RUT + discriminador de establecimiento (8 hex)
    expect(c.external_id).toMatch(/^217231960015#[0-9a-f]{8}$/);
    expect(c.source_confidence).toBe(0.9);
    expect(c.name).toBe("CULTO");
    expect(c.address).toBe("canelones 2154, MONTEVIDEO, MONTEVIDEO");
    expect(c.phone).toBe("094974477");
    expect(c.email).toBe("admin@cultocafe.uy");
    expect(c.website).toBeNull(); // era S/D
    // GPS del DEI NO se usa (ruidoso)
    expect(c.latitude).toBeNull();
    expect(c.longitude).toBeNull();
  });

  it("usa Denominación Social cuando no hay Nombre comercial", () => {
    const c = mapRecord(makeRecord({ "Nombre comercial": "S/D" }));
    expect(c.name).toBe("ANFANG S. R. L.");
  });

  it("tolera campos numéricos del datastore (teléfono/RUT como number, no string)", () => {
    // CKAN a veces devuelve la columna tipada como número → no debe romper.
    const rec = makeRecord({
      RUT: 217231960015 as unknown as string,
      "Numero de telefono": 94974477 as unknown as string,
    });
    const c = mapRecord(rec);
    // N86: RUT + discriminador de establecimiento (8 hex)
    expect(c.external_id).toMatch(/^217231960015#[0-9a-f]{8}$/);
    expect(c.phone).toBe("94974477");
  });
});

describe("DEIProvider.discover", () => {
  it("filtra por departamento (resuelve grafía canónica, sin probe)", async () => {
    mockFetch.mockResolvedValueOnce(makeCKANResponse([makeRecord()], 1)); // fetchAllRecords directo
    const provider = new DEIProvider();
    const out = await provider.discover(BASE_QUERY);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("CULTO");
    expect(mockFetch).toHaveBeenCalledTimes(1); // sin probeFilter
    const url = decodeURIComponent(String(mockFetch.mock.calls[0]![0])).replace(/\+/g, " ");
    expect(url).toContain("Departamento (EP)");
    expect(url).toContain("MONTEVIDEO");
  });

  it("F1.5: 'Paysandu' (sin tilde) resuelve a PAYSANDÚ, no baja el padrón nacional", async () => {
    mockFetch.mockResolvedValueOnce(makeCKANResponse([makeRecord({ "Departamento (EP)": "PAYSANDÚ" })], 1));
    const provider = new DEIProvider();
    const out = await provider.discover({ niche: "other", location: "Paysandu" });
    expect(out).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(mockFetch.mock.calls[0]![0])).replace(/\+/g, " ");
    expect(url).toContain("PAYSANDÚ");
  });

  it("F1.5: location desconocida (ciudad/typo) devuelve vacío, NUNCA nacional", async () => {
    const provider = new DEIProvider();
    const out = await provider.discover({ niche: "other", location: "Atlantida" });
    expect(out).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled(); // no se descarga nada
  });

  it("location vacío trae el padrón nacional sin probe", async () => {
    mockFetch.mockResolvedValueOnce(makeCKANResponse([makeRecord(), makeRecord({ _id: 2, RUT: "2", "Nombre comercial": "OTRO" })], 2));
    const provider = new DEIProvider();
    const out = await provider.discover({ niche: "other", location: "" });
    expect(out).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1); // sin probeFilter
  });

  it("descarta no aprobados en el resultado", async () => {
    mockFetch.mockResolvedValueOnce(
      makeCKANResponse([makeRecord(), makeRecord({ _id: 2, RUT: "2", "Estado de la empresa": "Pendiente" })], 2)
    );
    const provider = new DEIProvider();
    const out = await provider.discover(BASE_QUERY);
    expect(out).toHaveLength(1);
  });
});

describe("config DEI por env (F6.3)", () => {
  afterEach(() => {
    delete process.env["DEI_BASE_URL"];
    delete process.env["DEI_RESOURCE_ID"];
  });

  it("usa defaults sin env", async () => {
    const { deiBaseUrl, deiResourceId } = await import("../../src/modules/discovery/providers/dei.js");
    expect(deiBaseUrl()).toContain("catalogodatos.gub.uy");
    expect(deiResourceId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("DEI_BASE_URL/DEI_RESOURCE_ID overridean", async () => {
    const { deiBaseUrl, deiResourceId } = await import("../../src/modules/discovery/providers/dei.js");
    process.env["DEI_BASE_URL"] = "https://otro.host/api";
    process.env["DEI_RESOURCE_ID"] = "nuevo-id";
    expect(deiBaseUrl()).toBe("https://otro.host/api");
    expect(deiResourceId()).toBe("nuevo-id");
  });
});
