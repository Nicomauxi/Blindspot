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

describe("nicheToOsmFilters", () => {
  it('niche=restaurant → solo ["amenity"="restaurant"]', () => {
    expect(nicheToOsmFilters("restaurant")).toEqual(['["amenity"="restaurant"]']);
  });

  it('niche=healthcare → retorna clinic, doctors y hospital', () => {
    expect(nicheToOsmFilters("healthcare")).toEqual([
      '["amenity"="clinic"]',
      '["amenity"="doctors"]',
      '["amenity"="hospital"]',
    ]);
  });

  it('niche=dentist → solo ["amenity"="dentist"]', () => {
    expect(nicheToOsmFilters("dentist")).toEqual(['["amenity"="dentist"]']);
  });

  it('niche=bakery → solo ["shop"="bakery"]', () => {
    expect(nicheToOsmFilters("bakery")).toEqual(['["shop"="bakery"]']);
  });

  it("niche=other → retorna todos los filtros únicos", () => {
    const filters = nicheToOsmFilters("other");
    expect(filters).toHaveLength(new Set(Object.values(NICHE_OSM_TAGS).flat()).size);
  });
});

describe("buildQuery", () => {
  const filters = ['["amenity"="restaurant"]'];
  const bbox: [number, number, number, number] = [-34.95, -56.42, -34.77, -56.0];

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
});

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
});

describe("mapElement", () => {
  it("node: usa lat/lon directos", () => {
    const candidate = mapElement(makeNode({ lat: -34.9011, lon: -56.1645 }));
    expect(candidate.latitude).toBe(-34.9011);
    expect(candidate.longitude).toBe(-56.1645);
  });

  it("way: usa center.lat/center.lon", () => {
    const candidate = mapElement(makeWay({ center: { lat: -34.9022, lon: -56.1655 } }));
    expect(candidate.latitude).toBe(-34.9022);
    expect(candidate.longitude).toBe(-56.1655);
  });

  it("address construido correctamente", () => {
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

  it('niche inferido: amenity=dentist → "dentist"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "dentist" } }));
    expect(candidate.niche).toBe("dentist");
  });

  it('niche inferido: amenity=clinic → "healthcare"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "clinic" } }));
    expect(candidate.niche).toBe("healthcare");
  });

  it('niche inferido: shop=bakery → "bakery"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", shop: "bakery" } }));
    expect(candidate.niche).toBe("bakery");
  });

  it('niche inferido: amenity=veterinary → "veterinary"', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "veterinary" } }));
    expect(candidate.niche).toBe("veterinary");
  });

  it('niche → "other" cuando tag desconocido', () => {
    const candidate = mapElement(makeNode({ tags: { name: "X", amenity: "bank" } }));
    expect(candidate.niche).toBe("other");
  });
});

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

  it("normaliza location con coma y sufijo país", async () => {
    mockFetch.mockResolvedValueOnce(makeOverpassResponse([makeNode()]));

    const result = await provider.discover({ niche: "restaurant", location: "Colonia del Sacramento, Uruguay" });

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("location desconocida → retorna [] sin hacer requests", async () => {
    const result = await provider.discover({ niche: "restaurant", location: "Ciudad Desconocida" });

    expect(result).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propaga error HTTP sin swallow", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({}),
    });

    await expect(provider.discover(BASE_QUERY)).rejects.toThrow("Overpass API error: 429");
  });
});
