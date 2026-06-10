// Utilidades compartidas de texto/geo para matching cruzado entre fuentes.
// Antes vivían duplicadas en deduplication.ts y reconciliation.ts; centralizarlas
// evita que un fix se aplique en un solo lado.

const COUNTRY_TOKENS = new Set(["uruguay", "argentina", "brasil", "brazil"]);

// Los 19 departamentos de Uruguay (normalizados sin acentos). Sirven para desambiguar
// el patrón "CIUDAD, DEPARTAMENTO" (mintur) donde el último segmento es el departamento.
const UY_DEPARTMENTS = new Set([
  "artigas",
  "canelones",
  "cerro largo",
  "colonia",
  "durazno",
  "flores",
  "florida",
  "lavalleja",
  "maldonado",
  "montevideo",
  "paysandu",
  "rio negro",
  "rivera",
  "rocha",
  "salto",
  "san jose",
  "soriano",
  "tacuarembo",
  "treinta y tres",
]);

function looksLikeStreet(part: string): boolean {
  return /\d/.test(part);
}

// Coordenadas válidas para descartar NaN/Infinity/fuera de rango antes de construir WKT.
export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\b(avenida|av|calle|ruta|km|kilometro|numero|nro|esquina)\b/g, " ")
    .replace(/[^a-z0-9,]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

// Quita códigos postales y dígitos sueltos de un segmento para dejar solo el topónimo.
function cleanCityToken(part: string): string {
  return part
    .replace(/\b\d{3,5}\b/g, " ")
    .replace(/\bs\/?n\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCountryToken(part: string): boolean {
  return COUNTRY_TOKENS.has(part.trim());
}

// Extrae la ciudad de una dirección, robusta a las diferencias de formato entre fuentes:
// Google termina en "…, Departamento de X, Uruguay"; mintur en "…, CIUDAD, DEPARTAMENTO";
// osm en "…, ciudad". Descarta país, "departamento de …" y códigos postales.
export function extractAddressCity(value: string | null | undefined): string | null {
  const normalized = normalizeAddress(value);
  if (!normalized) return null;

  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);

  let departamentoFallback: string | null = null;
  const cityParts: Array<{ city: string; isStreet: boolean }> = [];

  for (const part of parts) {
    if (isCountryToken(part)) continue;

    const deptMatch = part.match(/^departamento de\s+(.+)$/) ?? part.match(/^depto\.?\s+(.+)$/);
    if (deptMatch) {
      const dept = cleanCityToken(deptMatch[1] ?? "");
      if (dept) departamentoFallback = dept;
      continue;
    }

    // Un segmento que es solo un número de puerta ("Orinoco, 4943, Montevideo")
    // pertenece a la calle anterior, no es una ciudad: marcamos el previo como calle
    // para que el patrón "CIUDAD, DEPARTAMENTO" no lo confunda con un topónimo.
    if (/^\d{1,4}$/.test(part.trim())) {
      const last = cityParts[cityParts.length - 1];
      if (last) last.isStreet = true;
      continue;
    }

    const cleaned = cleanCityToken(part);
    if (cleaned.length === 0) continue;
    // "isStreet" se evalúa sobre el segmento original (con su número), antes de limpiarlo.
    cityParts.push({ city: cleaned, isStreet: looksLikeStreet(part) });
  }

  if (cityParts.length > 0) {
    const last = cityParts[cityParts.length - 1]!;
    // Patrón mintur "CIUDAD, DEPARTAMENTO": si el último segmento es un departamento
    // conocido y el anterior es un topónimo (no una calle), la ciudad es el anterior.
    if (UY_DEPARTMENTS.has(last.city) && cityParts.length >= 2) {
      const prev = cityParts[cityParts.length - 2]!;
      if (!prev.isStreet) return prev.city;
    }
    // Direcciones de un solo segmento que son solo una calle no aportan ciudad:
    // devolver un fragmento de calle generaría falsos negativos en el cruce.
    // Caemos al fallback por palabra clave / departamento.
    if (!(cityParts.length === 1 && last.isStreet)) {
      return last.city;
    }
  }

  if (departamentoFallback) return departamentoFallback;

  // Fallback para direcciones de un solo segmento sin estructura por comas.
  const cityHints = [
    "montevideo",
    "maldonado",
    "punta del este",
    "punta del diablo",
    "la barra",
    "atlantida",
    "ciudad de la costa",
    "colonia",
    "piriapolis",
    "salto",
    "rocha",
    "canelones",
    "paysandu",
    "rivera",
    "tacuarembo",
    "minas",
    "mercedes",
  ];
  for (const hint of cityHints) {
    // Coincidencia por palabra completa para evitar falsos positivos por substring
    // (ej. "colonia valdense" no debe resolver a "colonia").
    if (new RegExp(`\\b${hint}\\b`).test(normalized)) return hint;
  }

  return null;
}

export function parseLeadGps(
  gps: unknown
): { lat: number; lng: number } | null {
  if (!gps) return null;

  const result = ((): { lat: number; lng: number } | null => {
    if (typeof gps === "string") {
      const match = gps.match(/POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/);
      if (match) {
        return { lng: Number(match[1]), lat: Number(match[2]) };
      }
      return null;
    }

    if (typeof gps === "object") {
      const record = gps as Record<string, unknown>;
      const coordinates = record["coordinates"];
      if (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        typeof coordinates[0] === "number" &&
        typeof coordinates[1] === "number"
      ) {
        return { lng: coordinates[0], lat: coordinates[1] };
      }

      if (typeof record["lat"] === "number" && typeof record["lng"] === "number") {
        return { lat: record["lat"], lng: record["lng"] };
      }

      if (typeof record["latitude"] === "number" && typeof record["longitude"] === "number") {
        return { lat: record["latitude"], lng: record["longitude"] };
      }
    }

    return null;
  })();

  if (result && !isValidCoord(result.lat, result.lng)) return null;
  return result;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}
