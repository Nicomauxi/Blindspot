import { OSM_USER_AGENT } from "../../../shared/user-agents.js";
import { fetch, Agent } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";
import { normalizeLocationKey } from "../normalize.js";

const SOURCE: DiscoverySource = "osm";
const SOURCE_CONFIDENCE = 0.6;
const OVERPASS_URL = "http://overpass.openstreetmap.fr/api/interpreter";
// Forzar IPv4 — el servidor resuelve a IPv6 pero este ambiente no tiene conectividad IPv6
const ipv4Agent = new Agent({ connect: { family: 4 } });

export const NICHE_OSM_TAGS: Record<string, string[]> = {
  restaurant: ["amenity=restaurant"],
  gym: ["leisure=gym"],
  hairdresser: ["shop=hairdresser"],
  car_dealer: ["shop=car"],
  pharmacy: ["amenity=pharmacy"],
  grocery: ["shop=supermarket"],
  dentist: ["amenity=dentist"],
  healthcare: ["amenity=clinic", "amenity=doctors", "amenity=hospital"],
  bakery: ["shop=bakery"],
  veterinary: ["amenity=veterinary"],
};

const OSM_TAG_TO_NICHE: Record<string, string> = Object.fromEntries(
  Object.entries(NICHE_OSM_TAGS).flatMap(([niche, tags]) => tags.map((tag) => [tag, niche]))
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
  canelones: [-34.76, -56.35, -34.45, -55.70],
  "ciudad de la costa": [-34.86, -56.10, -34.79, -55.93],
  "las piedras": [-34.76, -56.27, -34.69, -56.18],
  pando: [-34.75, -56.04, -34.68, -55.89],
  atlantida: [-34.79, -55.79, -34.74, -55.72],
  salinas: [-34.81, -55.87, -34.76, -55.79],
  colonia: [-34.50, -57.90, -34.40, -57.80],
  "colonia del sacramento": [-34.48, -57.86, -34.46, -57.82],
  carmelo: [-34.04, -58.33, -33.96, -58.24],
  maldonado: [-34.95, -55.00, -34.85, -54.90],
  "punta del este": [-34.98, -55.00, -34.90, -54.93],
  piriapolis: [-34.89, -55.31, -34.84, -55.25],
  "san carlos": [-34.83, -54.97, -34.75, -54.88],
  salto: [-31.42, -58.10, -31.35, -58.01],
  paysandu: [-32.35, -58.10, -32.26, -58.04],
  rivera: [-30.92, -55.57, -30.85, -55.50],
  rocha: [-34.52, -54.37, -34.45, -54.30],
  "la paloma": [-34.68, -54.18, -34.64, -54.13],
  minas: [-34.40, -55.28, -34.35, -55.20],
  durazno: [-33.40, -56.56, -33.34, -56.48],
  mercedes: [-33.28, -58.08, -33.22, -58.00],
  melo: [-32.39, -54.20, -32.34, -54.13],
  "san jose de mayo": [-34.36, -56.75, -34.31, -56.68],
  florida: [-34.11, -56.24, -34.08, -56.19],
  trinidad: [-33.56, -56.92, -33.52, -56.86],
  "fray bentos": [-33.14, -58.34, -33.11, -58.29],
  artigas: [-30.43, -56.50, -30.37, -56.43],
  tacuarembo: [-31.75, -56.02, -31.69, -55.95],
  chuy: [-33.71, -53.48, -33.68, -53.45],
  "rio branco": [-32.62, -53.42, -32.58, -53.37],
};

function locationToBbox(location: string): [number, number, number, number] | null {
  return UY_BBOXES[normalizeLocationKey(location)] ?? null;
}

function tagToFilter(tag: string): string {
  const [key, value] = tag.split("=");
  return `["${key}"="${value}"]`;
}

export function nicheToOsmFilters(niche: string): string[] {
  const tags = NICHE_OSM_TAGS[niche];
  if (tags) return tags.map(tagToFilter);
  return [...new Set(Object.values(NICHE_OSM_TAGS).flat())].map(tagToFilter);
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

  // N84: un housenumber sin calle no es una dirección ('1234, Montevideo' rompía el
  // matching por puerta). El número solo acompaña a la calle.
  const street = typeof tags["addr:street"] === "string" && tags["addr:street"].length > 0 ? tags["addr:street"] : null;
  const houseNumber = typeof tags["addr:housenumber"] === "string" && tags["addr:housenumber"].length > 0 ? tags["addr:housenumber"] : null;
  const city = typeof tags["addr:city"] === "string" && tags["addr:city"].length > 0 ? tags["addr:city"] : null;
  const addressParts = [
    street ? (houseNumber ? `${street} ${houseNumber}` : street) : null,
    city,
  ].filter((v): v is string => v !== null);

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
      "User-Agent": OSM_USER_AGENT,
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
