import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MINTURRecord } from "../../src/modules/discovery/providers/mintur.js";
import {
  isBlank,
  parsePhone,
  shouldDiscard,
  mapRecord,
  MINTURProvider,
} from "../../src/modules/discovery/providers/mintur.js";

// Mock undici before importing the module under test
vi.mock("undici", () => ({
  Agent: class MockAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}));

import { fetch } from "undici";
const mockFetch = fetch as ReturnType<typeof vi.fn>;

function makeCKANResponse(records: MINTURRecord[], total?: number) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () =>
      Promise.resolve({
        result: {
          total: total ?? records.length,
          records,
        },
      }),
  };
}

function makeRecord(overrides: Partial<MINTURRecord> = {}): MINTURRecord {
  return {
    _id: 1,
    Operador: "Hotel Ejemplo",
    Direccion: "Av. 18 de Julio 1234",
    Departamento: "MONTEVIDEO",
    Localidad: "MONTEVIDEO",
    Web: "https://hotel-ejemplo.com.uy",
    Telefono: "29001234",
    EMail: "info@hotel-ejemplo.com.uy",
    ...overrides,
  };
}

const BASE_QUERY = { niche: "other" as const, location: "Montevideo" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isBlank ───────────────────────────────────────────────────────────────────

describe("isBlank", () => {
  it("retorna true para null/undefined", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
  });

  it("retorna true para string vacío o whitespace", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
  });

  it("retorna true para sentinel values MINTUR", () => {
    expect(isBlank("S/D")).toBe(true);
    expect(isBlank("s/d")).toBe(true);
    expect(isBlank("NO DECLARA")).toBe(true);
    expect(isBlank("PENDIENTE")).toBe(true);
    expect(isBlank("S/N")).toBe(true);
  });

  it("retorna false para valores reales", () => {
    expect(isBlank("Hotel Ejemplo")).toBe(false);
    expect(isBlank("info@hotel.com.uy")).toBe(false);
    expect(isBlank("29001234")).toBe(false);
  });
});

// ─── parsePhone ────────────────────────────────────────────────────────────────

describe("parsePhone", () => {
  it("retorna null para string vacío", () => {
    expect(parsePhone("")).toBeNull();
  });

  it("retorna null para solo whitespace", () => {
    expect(parsePhone("   ")).toBeNull();
  });

  it("retorna el teléfono único sin modificar", () => {
    expect(parsePhone("29001234")).toBe("29001234");
  });

  it("toma el primer token cuando hay múltiples separados por guión", () => {
    expect(parsePhone("47725996 - 097226790")).toBe("47725996");
  });

  it("toma el primer token separado por coma", () => {
    expect(parsePhone("29001234, 29005678")).toBe("29001234");
  });

  it("toma el primer token separado por pipe", () => {
    expect(parsePhone("29001234 | 29005678")).toBe("29001234");
  });
});

// ─── shouldDiscard ─────────────────────────────────────────────────────────────

describe("shouldDiscard", () => {
  it("no descarta record válido con todos los campos", () => {
    expect(shouldDiscard(makeRecord())).toBe(false);
  });

  it("descarta si Operador está vacío", () => {
    expect(shouldDiscard(makeRecord({ Operador: "" }))).toBe(true);
  });

  it("descarta si Operador es solo whitespace", () => {
    expect(shouldDiscard(makeRecord({ Operador: "   " }))).toBe(true);
  });

  it("descarta si Operador es sentinel 'S/D'", () => {
    expect(shouldDiscard(makeRecord({ Operador: "S/D" }))).toBe(true);
  });

  it("descarta si Operador es sentinel 'NO DECLARA'", () => {
    expect(shouldDiscard(makeRecord({ Operador: "NO DECLARA" }))).toBe(true);
  });

  it("descarta si Email, Telefono y Web están todos vacíos", () => {
    expect(
      shouldDiscard(makeRecord({ EMail:"", Telefono: "", Web: "" }))
    ).toBe(true);
  });

  it("descarta si Email, Telefono y Web son todos sentinel 'S/D'", () => {
    expect(
      shouldDiscard(makeRecord({ EMail:"S/D", Telefono: "S/D", Web: "S/D" }))
    ).toBe(true);
  });

  it("no descarta si solo tiene Email (Telefono y Web vacíos)", () => {
    expect(
      shouldDiscard(makeRecord({ Telefono: "", Web: "", EMail:"a@b.com" }))
    ).toBe(false);
  });

  it("no descarta si solo tiene Telefono", () => {
    expect(
      shouldDiscard(makeRecord({ EMail:"", Web: "", Telefono: "29001234" }))
    ).toBe(false);
  });

  it("no descarta si solo tiene Web", () => {
    expect(
      shouldDiscard(makeRecord({ EMail:"", Telefono: "", Web: "https://x.com" }))
    ).toBe(false);
  });
});

// ─── mapRecord ─────────────────────────────────────────────────────────────────

describe("mapRecord", () => {
  it("mapea todos los campos correctamente", () => {
    const record = makeRecord({
      _id: 42,
      Operador: "Restaurant Test",
      Direccion: "Rambla 100",
      Localidad: "PUNTA DEL ESTE",
      Departamento: "MALDONADO",
      Web: "https://restaurant.uy",
      Telefono: "42000000",
      EMail:"test@restaurant.uy",
    });
    const candidate = mapRecord(record);

    expect(candidate.source).toBe("mintur");
    expect(candidate.external_id).toBe("42");
    expect(candidate.source_confidence).toBe(0.8);
    expect(candidate.name).toBe("Restaurant Test");
    expect(candidate.address).toBe("Rambla 100, PUNTA DEL ESTE, MALDONADO");
    expect(candidate.phone).toBe("42000000");
    expect(candidate.website).toBe("https://restaurant.uy");
    expect(candidate.email).toBe("test@restaurant.uy");
    expect(candidate.latitude).toBeNull();
    expect(candidate.longitude).toBeNull();
    expect(candidate.niche).toBe("other");
    expect(candidate.raw).toBe(record);
  });

  it("address omite campos vacíos", () => {
    const candidate = mapRecord(makeRecord({ Direccion: "", Localidad: "MONTEVIDEO", Departamento: "MONTEVIDEO" }));
    expect(candidate.address).toBe("MONTEVIDEO, MONTEVIDEO");
  });

  it("website es null cuando Web está vacío", () => {
    const candidate = mapRecord(makeRecord({ Web: "" }));
    expect(candidate.website).toBeNull();
  });

  it("email es null cuando Email está vacío", () => {
    const candidate = mapRecord(makeRecord({ EMail:"" }));
    expect(candidate.email).toBeNull();
  });

  it("phone es null cuando Telefono es sentinel 'S/D'", () => {
    const candidate = mapRecord(makeRecord({ Telefono: "S/D" }));
    expect(candidate.phone).toBeNull();
  });

  it("website es null cuando Web es sentinel 'S/D'", () => {
    const candidate = mapRecord(makeRecord({ Web: "S/D" }));
    expect(candidate.website).toBeNull();
  });

  it("parsea teléfonos múltiples tomando solo el primero", () => {
    const candidate = mapRecord(makeRecord({ Telefono: "47725996 - 097226790" }));
    expect(candidate.phone).toBe("47725996");
  });
});

// ─── MINTURProvider.discover ───────────────────────────────────────────────────

describe("MINTURProvider.discover", () => {
  const provider = new MINTURProvider();

  it("propiedades estáticas", () => {
    expect(provider.source).toBe("mintur");
    expect(provider.sourceConfidence).toBe(0.8);
  });

  it("usa filtro Departamento cuando da resultados", async () => {
    const records = [makeRecord({ _id: 1 }), makeRecord({ _id: 2 })];

    mockFetch
      // probe Departamento → total=2
      .mockResolvedValueOnce(makeCKANResponse([], 2))
      // página completa Departamento
      .mockResolvedValueOnce(makeCKANResponse(records, 2));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(2);

    // Verifica que el primer fetch usó filters con Departamento=MONTEVIDEO
    const firstUrl = mockFetch.mock.calls[0]![0] as string;
    expect(firstUrl).toContain("filters=");
    expect(firstUrl).toContain("Departamento");
    expect(firstUrl).toContain("MONTEVIDEO");
  });

  it("cae a filtro Localidad cuando Departamento da 0 resultados", async () => {
    const records = [makeRecord({ _id: 3 })];

    mockFetch
      // probe Departamento → total=0
      .mockResolvedValueOnce(makeCKANResponse([], 0))
      // probe Localidad → total=1
      .mockResolvedValueOnce(makeCKANResponse([], 1))
      // página completa Localidad
      .mockResolvedValueOnce(makeCKANResponse(records, 1));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);
    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    expect(secondUrl).toContain("Localidad");
  });

  it("cae a sin filtro cuando Departamento y Localidad dan 0 resultados", async () => {
    const records = [makeRecord({ _id: 10 })];

    mockFetch
      // probe Departamento → 0
      .mockResolvedValueOnce(makeCKANResponse([], 0))
      // probe Localidad → 0
      .mockResolvedValueOnce(makeCKANResponse([], 0))
      // página sin filtro
      .mockResolvedValueOnce(makeCKANResponse(records, 1));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);

    // El tercer fetch no debe incluir "filters"
    const thirdUrl = mockFetch.mock.calls[2]![0] as string;
    expect(thirdUrl).not.toContain("filters=");
  });

  it("pagina correctamente hasta cubrir el total (2 páginas)", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => makeRecord({ _id: i + 1 }));
    const page2 = Array.from({ length: 200 }, (_, i) => makeRecord({ _id: i + 501 }));

    mockFetch
      // probe Departamento → total=700
      .mockResolvedValueOnce(makeCKANResponse([], 700))
      // página 1 (offset=0)
      .mockResolvedValueOnce(makeCKANResponse(page1, 700))
      // página 2 (offset=500)
      .mockResolvedValueOnce(makeCKANResponse(page2, 700));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(700);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const page2Url = mockFetch.mock.calls[2]![0] as string;
    expect(page2Url).toContain("offset=500");
  });

  it("descarta records con Operador vacío", async () => {
    const records = [
      makeRecord({ _id: 1, Operador: "Hotel Válido" }),
      makeRecord({ _id: 2, Operador: "" }),
      makeRecord({ _id: 3, Operador: "   " }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeCKANResponse([], 3))
      .mockResolvedValueOnce(makeCKANResponse(records, 3));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Hotel Válido");
  });

  it("descarta records sin Email + Telefono + Web", async () => {
    const records = [
      makeRecord({ _id: 1 }),
      makeRecord({ _id: 2, EMail:"", Telefono: "", Web: "" }),
    ];

    mockFetch
      .mockResolvedValueOnce(makeCKANResponse([], 2))
      .mockResolvedValueOnce(makeCKANResponse(records, 2));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);
    expect(result[0]!.external_id).toBe("1");
  });

  it("propaga errores de red sin swallow", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network failure"));

    await expect(provider.discover(BASE_QUERY)).rejects.toThrow("network failure");
  });

  it("propaga error HTTP (status !== 2xx)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({}),
    });

    await expect(provider.discover(BASE_QUERY)).rejects.toThrow("MINTUR API error: 503");
  });
});
