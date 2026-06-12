import { normalizeLocationKey } from "./normalize.js";

// Uruguay bounding box (conservative)
const URUGUAY_LAT_MIN = -35.00;
const URUGUAY_LAT_MAX = -30.08;
const URUGUAY_LNG_MIN = -58.44;
const URUGUAY_LNG_MAX = -53.17;

// Departamento bounding boxes (approximate) for inferencing
type BBox = { latMin: number; latMax: number; lngMin: number; lngMax: number };
const DEPARTAMENTO_BBOXES: Record<string, BBox> = {
  Artigas:       { latMin: -30.95, latMax: -30.08, lngMin: -57.65, lngMax: -55.60 },
  Canelones:     { latMin: -34.82, latMax: -34.00, lngMin: -56.50, lngMax: -55.60 },
  "Cerro Largo": { latMin: -33.20, latMax: -31.60, lngMin: -54.55, lngMax: -53.25 },
  Colonia:       { latMin: -34.48, latMax: -33.58, lngMin: -58.44, lngMax: -57.07 },
  Durazno:       { latMin: -33.90, latMax: -32.20, lngMin: -56.80, lngMax: -55.00 },
  Flores:        { latMin: -34.10, latMax: -33.20, lngMin: -57.10, lngMax: -56.10 },
  Florida:       { latMin: -34.35, latMax: -33.30, lngMin: -56.45, lngMax: -55.60 },
  Lavalleja:     { latMin: -34.60, latMax: -33.35, lngMin: -55.85, lngMax: -54.80 },
  Maldonado:     { latMin: -35.00, latMax: -33.85, lngMin: -55.40, lngMax: -53.17 },
  Montevideo:    { latMin: -35.00, latMax: -34.50, lngMin: -56.55, lngMax: -56.00 },
  Paysandú:      { latMin: -33.00, latMax: -30.80, lngMin: -58.30, lngMax: -57.00 },
  "Río Negro":   { latMin: -33.25, latMax: -32.30, lngMin: -58.30, lngMax: -57.20 },
  Rivera:        { latMin: -31.80, latMax: -30.60, lngMin: -56.10, lngMax: -54.50 },
  Rocha:         { latMin: -34.70, latMax: -33.60, lngMin: -54.55, lngMax: -53.17 },
  Salto:         { latMin: -31.60, latMax: -30.15, lngMin: -58.45, lngMax: -57.05 },
  "San José":    { latMin: -34.65, latMax: -33.75, lngMin: -57.45, lngMax: -56.15 },
  Soriano:       { latMin: -34.00, latMax: -32.90, lngMin: -58.30, lngMax: -57.20 },
  Tacuarembó:    { latMin: -32.90, latMax: -31.30, lngMin: -56.50, lngMax: -54.90 },
  Treinta:       { latMin: -33.45, latMax: -32.60, lngMin: -54.80, lngMax: -53.60 },
};

// Normalized city → departamento for string-based fallback
const CITY_TO_DEPARTAMENTO: Record<string, string> = {
  montevideo:     "Montevideo",
  "las piedras":  "Canelones",
  pando:          "Canelones",
  "ciudad de la costa": "Canelones",
  salinas:        "Canelones",
  atlantida:      "Canelones",
  progreso:       "Canelones",
  "santa lucia":  "Canelones",
  maldonado:      "Maldonado",
  "punta del este": "Maldonado",
  "san carlos":   "Maldonado",
  piriapolis:     "Maldonado",
  salto:          "Salto",
  paysandu:       "Paysandú",
  rivera:         "Rivera",
  "colonia del sacramento": "Colonia",
  "nueva helvecia": "Colonia",
  "juan lacaze":  "Colonia",
  carmelo:        "Colonia",
  tacuarembo:     "Tacuarembó",
  melo:           "Cerro Largo",
  mercedes:       "Soriano",
  artigas:        "Artigas",
  minas:          "Lavalleja",
  "san jose":     "San José",
  durazno:        "Durazno",
  florida:        "Florida",
  trinidad:       "Flores",
  rocha:          "Rocha",
  "fray bentos":  "Río Negro",
  dolores:        "Soriano",
  young:          "Río Negro",
};

// Países extranjeros limítrofes que aparecen en direcciones de fuentes externas.
const FOREIGN_COUNTRY_TOKENS = new Set(["argentina", "brasil", "brazil"]);

function normalizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

/**
 * ¿La dirección corresponde a un negocio fuera de Uruguay? F1.3.
 * Se ANCLA en el ÚLTIMO segmento (el país), no en una búsqueda libre del token:
 * eso evita falsos positivos por calles llamadas "Argentina"/"Brasil" en UY
 * (p.ej. "Av. Argentina esq. ..., Canelones, Uruguay" o "BRASIL 2524, Montevideo").
 */
export function isForeignAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  const last = normalizeSegment(segments[segments.length - 1] ?? "");
  return FOREIGN_COUNTRY_TOKENS.has(last);
}

export function isWithinUruguay(lat: number, lng: number): boolean {
  return (
    lat >= URUGUAY_LAT_MIN &&
    lat <= URUGUAY_LAT_MAX &&
    lng >= URUGUAY_LNG_MIN &&
    lng <= URUGUAY_LNG_MAX
  );
}

export function inferDepartamento(
  lat: number | null,
  lng: number | null,
  locationString: string
): string | null {
  // GPS-based lookup first
  if (lat !== null && lng !== null) {
    for (const [dep, bbox] of Object.entries(DEPARTAMENTO_BBOXES)) {
      if (lat >= bbox.latMin && lat <= bbox.latMax && lng >= bbox.lngMin && lng <= bbox.lngMax) {
        return dep;
      }
    }
  }
  // String-based fallback
  const key = normalizeLocationKey(locationString);
  return CITY_TO_DEPARTAMENTO[key] ?? null;
}
