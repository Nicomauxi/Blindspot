import { fetch, Agent } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";

const SOURCE: DiscoverySource = "osm";
const SOURCE_CONFIDENCE = 0.6;
const OVERPASS_URL = "http://overpass.openstreetmap.fr/api/interpreter";
// Forzar IPv4 — el servidor resuelve a IPv6 pero este ambiente no tiene conectividad IPv6
const ipv4Agent = new Agent({ connect: { family: 4 } });

export const NICHE_OSM_TAGS: Record<string, string> = {
  restaurant: "amenity=restaurant",
  gym: "leisure=gym",
  hairdresser: "shop=hairdresser",
  car_dealer: "shop=car",
};

// Tabla invertida: "amenity=restaurant" → "restaurant"
const OSM_TAG_TO_NICHE: Record<string, string> = Object.fromEntries(
  Object.entries(NICHE_OSM_TAGS).map(([niche, tag]) => [tag, niche])
);

export interface OSMElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OSMElement[];
}

// Bounding boxes para ubicaciones frecuentes de Uruguay
// Formato: [south, west, north, east]
const UY_BBOXES: Record<string, [number, number, number, number]> = {
  montevideo: [-34.95, -56.42, -34.77, -56.00],
  colonia: [-34.50, -57.90, -34.40, -57.80],
  maldonado: [-34.95, -55.00, -34.85, -54.90],
  "punta del este": [-34.98, -55.00, -34.90, -54.93],
  salto: [-31.42, -58.10, -31.35, -58.01],
  paysandu: [-32.35, -58.10, -32.26, -58.04],
  rivera: [-30.92, -55.57, -30.85, -55.50],
  minas: [-34.38, -55.26, -34.35, -55.22],
  durazno: [-33.38, -56.54, -33.34, -56.50],
  colonia_del_sacramento: [-34.48, -57.86, -34.46, -57.82],
};

function locationToBbox(location: string): [number, number, number, number] | null {
  return UY_BBOXES[location.toLowerCase().trim()] ?? null;
}

// Convierte "amenity=restaurant" → '["amenity"="restaurant"]'
function tagToFilter(tag: string): string {
  const [key, value] = tag.split("=");
  return `["${key}"="${value}"]`;
}

export function nicheToOsmFilters(niche: string): string[] {
  if (niche in NICHE_OSM_TAGS) {
    return [tagToFilter(NICHE_OSM_TAGS[niche]!)];
  }
  return Object.values(NICHE_OSM_TAGS).map(tagToFilter);
}

export function buildQuery(
  osmFilters: string[],
  bbox: [number, number, number, number]
): string {
  const [south, west, north, east] = bbox;
  const filterLines = osmFilters
    .map((f) => `  nwr${f}(${south},${west},${north},${east});`)
    .join("\n");
  return `[out:json][timeout:60];\n(\n${filterLines}\n);\nout center;`;
}

export function shouldDiscard(element: OSMElement): boolean {
  if (!element.tags) return true;
  const name = element.tags["name"];
  if (!name || name.trim().length === 0) return true;
  return false;
}

export function mapElement(element: OSMElement): DiscoveryCandidate {
  const tags = element.tags ?? {};

  const lat =
    element.type === "node" ? (element.lat ?? null) : (element.center?.lat ?? null);
  const lon =
    element.type === "node" ? (element.lon ?? null) : (element.center?.lon ?? null);

  const addressParts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:city"],
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  // Inferir niche desde tags OSM
  let niche = "other";
  for (const [tagStr, nicheVal] of Object.entries(OSM_TAG_TO_NICHE)) {
    const [key, value] = tagStr.split("=");
    if (tags[key!] === value) {
      niche = nicheVal;
      break;
    }
  }

  return {
    source: SOURCE,
    external_id: String(element.id),
    source_confidence: SOURCE_CONFIDENCE,
    name: tags["name"] ?? "",
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    phone: tags["phone"] ?? null,
    website: tags["website"] ?? null,
    email: tags["email"] ?? null,
    latitude: lat,
    longitude: lon,
    niche,
    raw: element as unknown as Record<string, unknown>,
  };
}

async function executeQuery(ql: string): Promise<OSMElement[]> {
  const body = `data=${encodeURIComponent(ql)}`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "blindspot-discovery/1.0 (contact@blindspot.uy)",
    },
    body,
    dispatcher: ipv4Agent,
  });
  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as OverpassResponse;
  return data.elements;
}

export class OSMProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const osmFilters = nicheToOsmFilters(query.niche);
    const bbox = locationToBbox(query.location);
    if (!bbox) {
      console.warn(`[OSMProvider] location "${query.location}" not in bbox map — skipping`);
      return [];
    }
    const ql = buildQuery(osmFilters, bbox);
    const elements = await executeQuery(ql);
    return elements.filter((e) => !shouldDiscard(e)).map(mapElement);
  }
}
