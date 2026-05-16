import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OSMElement } from "../../src/modules/discovery/providers/osm.js";
import {
  NICHE_OSM_TAGS,
  nicheToOsmFilters,
  buildQuery,
  shouldDiscard,
  mapElement,
  OSMProvider,
} from "../../src/modules/discovery/providers/osm.js";

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(),
  };
});

import { fetch } from "undici";
const mockFetch = fetch as ReturnType<typeof vi.fn>;

function makeOverpassResponse(elements: OSMElement[]) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ elements }),
  };
}

function makeNode(overrides: Partial<OSMElement> & { id?: number } = {}): OSMElement {
  return {
    type: "node",
    id: overrides.id ?? 123456789,
    lat: -34.9011,
    lon: -56.1645,
    tags: {
      amenity: "restaurant",
      name: "El Asado",
      "addr:street": "Agraciada",
      "addr:housenumber": "1234",
      "addr:city": "Montevideo",
      phone: "+598 2700 1234",
      website: "https://elasado.com.uy",
    },
    ...overrides,
  };
}

function makeWay(overrides: Partial<OSMElement> = {}): OSMElement {
  return {
    type: "way",
    id: 987654321,
    center: { lat: -34.9022, lon: -56.1655 },
    tags: {
      amenity: "restaurant",
      name: "La Cantina",
    },
    ...overrides,
  };
}

const BASE_QUERY = { niche: "other", location: "Montevideo" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── nicheToOsmFilters ─────────────────────────────────────────────────────────

describe("nicheToOsmFilters", () => {
  it('niche=restaurant → solo ["amenity"="restaurant"]', () => {
    expect(nicheToOsmFilters("restaurant")).toEqual(['["amenity"="restaurant"]']);
  });

  it('niche=gym → solo ["leisure"="gym"]', () => {
    expect(nicheToOsmFilters("gym")).toEqual(['["leisure"="gym"]']);
  });

  it('niche=hairdresser → solo ["shop"="hairdresser"]', () => {
    expect(nicheToOsmFilters("hairdresser")).toEqual(['["shop"="hairdresser"]']);
  });

  it('niche=car_dealer → solo ["shop"="car"]', () => {
    expect(nicheToOsmFilters("car_dealer")).toEqual(['["shop"="car"]']);
  });

  it("niche=other → retorna los 4 filtros", () => {
    const filters = nicheToOsmFilters("other");
    expect(filters).toHaveLength(Object.keys(NICHE_OSM_TAGS).length);
  });

  it("niche desconocido (dentist) → retorna los 4 filtros", () => {
    const filters = nicheToOsmFilters("dentist");
    expect(filters).toHaveLength(Object.keys(NICHE_OSM_TAGS).length);
  });
});

// ─── buildQuery ────────────────────────────────────────────────────────────────

describe("buildQuery", () => {
  const filters = ['["amenity"="restaurant"]'];
  const bbox: [number, number, number, number] = [-34.95, -56.42, -34.77, -56.00];

  it("contiene las coordenadas del bbox en el string", () => {
    const q = buildQuery(filters, bbox);
    expect(q).toContain("-34.95");
    expect(q).toContain("-56.42");
    expect(q).toContain("-34.77");
    expect(q).toContain("-56");
  });

  it("contiene out center al final", () => {
    const q = buildQuery(filters, bbox);
    expect(q.trimEnd()).toMatch(/out center;$/);
  });

  it("contiene las líneas nwr[...](bbox) para cada filtro", () => {
    const multiFilters = ['["amenity"="restaurant"]', '["leisure"="gym"]'];
    const q = buildQuery(multiFilters, bbox);
    expect(q).toContain('nwr["amenity"="restaurant"](-34.95,-56.42,-34.77,-56);');
    expect(q).toContain('nwr["leisure"="gym"](-34.95,-56.42,-34.77,-56);');
  });

  it("no contiene admin_level", () => {
    const q = buildQuery(filters, bbox);
    expect(q).not.toContain("admin_level");
  });

  it("empieza con [out:json]", () => {
    const q = buildQuery(filters, bbox);
    expect(q).toMatch(/^\[out:json\]/);
  });
});

// ─── shouldDiscard ─────────────────────────────────────────────────────────────

describe("shouldDiscard", () => {
  it("no descarta elemento con name tag", () => {
    expect(shouldDiscard(makeNode())).toBe(false);
  });

  it("descarta si tags es undefined", () => {
    expect(shouldDiscard({ type: "node", id: 1 })).toBe(true);
  });

  it("descarta si tags.name está vacío o solo whitespace", () => {
    expect(shouldDiscard(makeNode({ tags: { name: "" } }))).toBe(true);
    expect(shouldDiscard(makeNode({ tags: { name: "   " } }))).toBe(true);
  });

  it("descarta si tags.name es undefined", () => {
    expect(shouldDiscard(makeNode({ tags: { amenity: "restaurant" } }))).toBe(true);
  });
});

// ─── mapElement ────────────────────────────────────────────────────────────────

describe("mapElement", () => {
  it("node: usa lat/lon directos (no center)", () => {
    const candidate = mapElement(makeNode({ lat: -34.9011, lon: -56.1645 }));
    expect(candidate.latitude).toBe(-34.9011);
    expect(candidate.longitude).toBe(-56.1645);
  });

  it("way: usa center.lat/center.lon", () => {
    const candidate = mapElement(makeWay({ center: { lat: -34.9022, lon: -56.1655 } }));
    expect(candidate.latitude).toBe(-34.9022);
    expect(candidate.longitude).toBe(-56.1655);
  });

  it("address construido correctamente desde street + housenumber + city", () => {
    const candidate = mapElement(makeNode({
      tags: {
        name: "El Asado",
        "addr:street": "Agraciada",
        "addr:housenumber": "1234",
        "addr:city": "Montevideo",
      },
    }));
    expect(candidate.address).toBe("Agraciada, 1234, Montevideo");
  });

  it("address omite campos faltantes", () => {
    const candidate = mapElement(makeNode({
      tags: { name: "Sin Dirección", "addr:city": "Colonia" },
    }));
    expect(candidate.address).toBe("Colonia");
  });

  it("address es null cuando no hay campos de dirección", () => {
    const candidate = mapElement(makeNode({ tags: { name: "Sin Dir" } }));
    expect(candidate.address).toBeNull();
  });

  it("website mapeado cuando presente", () => {
    const candidate = mapElement(makeNode());
    expect(candidate.website).toBe("https://elasado.com.uy");
  });

  it("website null cuando ausente", () => {
    const candidate = mapElement(makeNode({ tags: { name: "Sin web" } }));
    expect(candidate.website).toBeNull();
  });

  it("phone mapeado cuando presente", () => {
    const candidate = mapElement(makeNode());
    expect(candidate.phone).toBe("+598 2700 1234");
  });

  it("phone null cuando ausente", () => {
    const candidate = mapElement(makeNode({ tags: { name: "Sin tel" } }));
    expect(candidate.phone).toBeNull();
  });

  it('niche inferido: amenity=restaurant → "restaurant"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "restaurant" } }));
    expect(candidate.niche).toBe("restaurant");
  });

  it('niche inferido: leisure=gym → "gym"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", leisure: "gym" } }));
    expect(candidate.niche).toBe("gym");
  });

  it('niche inferido: shop=hairdresser → "hairdresser"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", shop: "hairdresser" } }));
    expect(candidate.niche).toBe("hairdresser");
  });

  it('niche inferido: shop=car → "car_dealer"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", shop: "car" } }));
    expect(candidate.niche).toBe("car_dealer");
  });

  it('niche → "other" cuando tag desconocido', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "dentist" } }));
    expect(candidate.niche).toBe("other");
  });

  it("external_id es String(element.id)", () => {
    const candidate = mapElement(makeNode({ id: 999888777 }));
    expect(candidate.external_id).toBe("999888777");
  });

  it("source_confidence es 0.60", () => {
    const candidate = mapElement(makeNode());
    expect(candidate.source_confidence).toBe(0.6);
  });
});

// ─── OSMProvider.discover ──────────────────────────────────────────────────────

describe("OSMProvider.discover", () => {
  const provider = new OSMProvider();

  it('propiedades estáticas: source="osm", sourceConfidence=0.60', () => {
    expect(provider.source).toBe("osm");
    expect(provider.sourceConfidence).toBe(0.6);
  });

  it("location conocida (Montevideo) → hace exactamente 1 request y retorna candidates", async () => {
    mockFetch.mockResolvedValueOnce(makeOverpassResponse([makeNode()]));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("location desconocida → retorna [] sin hacer requests", async () => {
    const result = await provider.discover({ niche: "restaurant", location: "Ciudad Desconocida" });

    expect(result).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("location conocida sin resultados → retorna []", async () => {
    mockFetch.mockResolvedValueOnce(makeOverpassResponse([]));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("descarta elementos sin nombre antes de retornar", async () => {
    const elements = [
      makeNode({ id: 1, tags: { amenity: "restaurant", name: "Con Nombre" } }),
      makeNode({ id: 2, tags: { amenity: "restaurant" } }),
    ];
    mockFetch.mockResolvedValueOnce(makeOverpassResponse(elements));

    const result = await provider.discover(BASE_QUERY);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Con Nombre");
  });

  it("el POST body contiene data=", async () => {
    mockFetch.mockResolvedValueOnce(makeOverpassResponse([makeNode()]));

    await provider.discover(BASE_QUERY);

    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[1]?.body).toContain("data=");
  });

  it("propaga error HTTP sin swallow (status !== 2xx)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({}),
    });

    await expect(provider.discover(BASE_QUERY)).rejects.toThrow("Overpass API error: 429");
  });

  it("propaga errores de red (rejected promise)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network failure"));

    await expect(provider.discover(BASE_QUERY)).rejects.toThrow("network failure");
  });
});
