// Matching de direcciones tolerante a abreviaciones uruguayas.
//
// El problema: las calles con nombre de prócer aparecen abreviadas según la fuente
// ("Rivera" = "Gral. Fructuoso Rivera", "Artigas" = "Gral. José Gervasio Artigas").
// La distancia de edición no lo ve (sobra "gral fructuoso "), pero como CONJUNTOS de
// tokens es un subconjunto: {rivera} ⊆ {fructuoso, rivera}. Esa es la señal.
//
// El número de puerta es el ancla de alta precisión: puertas iguales confirman;
// puertas distintas descartan (separa sucursales de cadenas). La ciudad se compara
// aguas arriba en deduplication.ts; acá solo modelamos calle + puerta.

// Tipos de vía (abreviados y completos). Se descartan: no aportan identidad de calle.
const STREET_TYPE_TOKENS = new Set([
  "avenida", "av", "ave", "avda", "calle", "cl", "cno", "camino", "cam",
  "rambla", "rbla", "bulevar", "bvar", "bv", "ruta", "rta", "paso", "pasaje", "psje",
  "peatonal", "plaza", "pza", "continuacion", "cont", "diagonal", "diag", "acceso",
]);

// Títulos/honoríficos que se omiten al nombrar la calle ("Gral.", "Dr.", "Cnel."…).
// OJO: NO incluye san/santa/santo/don — son parte del nombre propio ("San Martín").
const HONORIFIC_TOKENS = new Set([
  "gral", "general", "cnel", "coronel", "tte", "teniente", "cap", "capitan",
  "sgto", "sargento", "brig", "brigadier", "alte", "almirante", "cmte", "comandante",
  "dr", "dra", "doctor", "doctora", "ing", "ingeniero", "arq", "arquitecto",
  "lic", "licenciado", "prof", "profesor", "profesora", "esc", "escribano",
  "cra", "cr", "contador", "pdte", "presidente", "mtro", "maestro", "pbro", "fray", "padre",
]);

// Conectores y referencias que no aportan identidad ("de", "esq", "casi"…).
const CONNECTOR_TOKENS = new Set([
  "de", "del", "la", "las", "los", "el", "y", "e",
  "esq", "esquina", "casi", "par", "parada", "entre",
]);

// Marcadores de unidad interna: el número que les sigue es apto/local/piso, NO la puerta. F2.3.
const UNIT_MARKER_TOKENS = new Set([
  "apto", "apt", "apartamento", "local", "of", "ofic", "oficina",
  "piso", "uc", "unidad", "depto", "dpto", "block", "bloque",
]);

// Topónimos que, en un segmento posterior al primero, marcan el fin de la calle.
const CITY_HINTS = new Set([
  "montevideo", "maldonado", "punta", "este", "diablo", "barra", "atlantida",
  "ciudad", "costa", "colonia", "piriapolis", "salto", "rocha", "canelones",
  "paysandu", "rivera", "tacuarembo", "minas", "mercedes", "florida", "durazno",
  "artigas", "soriano", "lavalleja", "flores", "trinidad", "melo", "fray bentos",
]);

const COUNTRY_TOKENS = new Set(["uruguay", "argentina", "brasil", "brazil"]);

const UY_DEPARTMENTS = new Set([
  "artigas", "canelones", "cerro largo", "colonia", "durazno", "flores", "florida",
  "lavalleja", "maldonado", "montevideo", "paysandu", "rio negro", "rivera", "rocha",
  "salto", "san jose", "soriano", "tacuarembo", "treinta y tres",
]);

// Plus-code de Google (Open Location Code): 4+ alfanuméricos, "+", 2-3 alfanuméricos.
const PLUSCODE_RE = /\b[a-z0-9]{4,}\+[a-z0-9]{2,3}\b/i;

export interface ParsedStreetAddress {
  /** Tokens significativos del nombre de calle (sin tipos de vía/honoríficos/conectores). */
  streetTokens: string[];
  /** Número de puerta (1-4 dígitos) como string, o null si no se detecta. */
  door: string | null;
  /** True si la dirección es (o contiene) un plus-code → sin calle usable. */
  hasPluscode: boolean;
}

function normalizeSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ¿El segmento (normalizado) marca el comienso de la parte ciudad/depto/país/CP?
function isCityishSegment(normalized: string): boolean {
  if (!normalized) return false;
  if (/\b\d{5}\b/.test(normalized)) return true; // código postal
  if (/^departamento de\b/.test(normalized) || /^depto\b/.test(normalized)) return true;
  if (COUNTRY_TOKENS.has(normalized)) return true;
  if (UY_DEPARTMENTS.has(normalized)) return true;
  // Segmento sin dígitos cuyas palabras son todas topónimos conocidos.
  if (!/\d/.test(normalized)) {
    const words = normalized.split(" ");
    if (words.every((w) => CITY_HINTS.has(w))) return true;
  }
  return false;
}

// Memo de parseo: la reconciliación O(n²) parsea la misma dirección miles de veces. F2.8/N5.2.
// La función es pura y su resultado se trata como solo-lectura → cachear por string es seguro.
const parseStreetAddressCache = new Map<string, ParsedStreetAddress>();

export function parseStreetAddress(value: string | null | undefined): ParsedStreetAddress {
  if (!value) return { streetTokens: [], door: null, hasPluscode: false };

  const cached = parseStreetAddressCache.get(value);
  if (cached) return cached;
  const parsed = parseStreetAddressUncached(value);
  parseStreetAddressCache.set(value, parsed);
  return parsed;
}

function parseStreetAddressUncached(value: string): ParsedStreetAddress {
  const hasPluscode = PLUSCODE_RE.test(value);

  // La calle es el primer segmento; sumamos los siguientes hasta el primero "ciudadesco".
  const rawSegments = value.split(",").map((s) => s.trim()).filter(Boolean);
  const streetSegs: string[] = [];
  rawSegments.forEach((seg, idx) => {
    const norm = normalizeSegment(seg);
    if (idx === 0) {
      streetSegs.push(norm);
      return;
    }
    if (isCityishSegment(norm)) return; // y todo lo posterior se ignora vía el flag
    if (streetSegs.length === idx) streetSegs.push(norm); // contiguo, aún parte de la calle
  });
  const streetPortion = streetSegs.join(" ").trim();
  if (!streetPortion) return { streetTokens: [], door: null, hasPluscode };

  const tokens = streetPortion.split(" ").filter(Boolean);

  // Índices de números de puerta candidatos (1-4 dígitos), excluyendo el número de un
  // nombre tipo fecha ("18 de Julio", "8 de Octubre"): un número seguido de "de"/"del".
  // (No excluye "784 y Artigas" — la "y" de esquina no marca nombre-fecha.)
  const isDateNameNum = (i: number): boolean => {
    const next = tokens[i + 1];
    return /^\d{1,4}$/.test(tokens[i]!) && (next === "de" || next === "del");
  };

  const doorCandidateIdx: number[] = [];
  tokens.forEach((t, i) => {
    if (!/^\d{1,4}$/.test(t)) return;
    // Excluir el número de un nombre-fecha ("18 de Julio") y el de una unidad interna
    // ("apto 5", "local 3") — no son la puerta. F2.3/F2.4.
    const prev = tokens[i - 1];
    if (isDateNameNum(i)) return;
    if (prev !== undefined && UNIT_MARKER_TOKENS.has(prev)) return;
    doorCandidateIdx.push(i);
  });
  // La puerta es el PRIMER número tras el nombre de calle, no el último
  // ("Av. Italia 3030 apto 5" → 3030, no 5). F2.3.
  const doorIdx = doorCandidateIdx.length > 0 ? doorCandidateIdx[0]! : -1;
  const door = doorIdx >= 0 ? tokens[doorIdx]! : null;

  const streetTokens: string[] = [];
  tokens.forEach((t, i) => {
    if (i === doorIdx) return;
    // Conservar el número de un nombre-fecha ("8 de Octubre" → token "8" significativo),
    // que de otro modo el filtro de longitud descartaría. F2.4.
    if (t.length < 2 && !isDateNameNum(i)) return;
    if (STREET_TYPE_TOKENS.has(t) || HONORIFIC_TOKENS.has(t) || CONNECTOR_TOKENS.has(t)) return;
    streetTokens.push(t);
  });

  return { streetTokens, door, hasPluscode };
}

// ¿Dos puertas presentes y distintas? Señal fuerte de direcciones distintas
// (separa sucursales de cadenas: Devoto Rivera 4502 ≠ Devoto Arenal 2006).
export function doorsConflict(a: ParsedStreetAddress, b: ParsedStreetAddress): boolean {
  return a.door !== null && b.door !== null && a.door !== b.door;
}

export function streetAddressesMatch(a: ParsedStreetAddress, b: ParsedStreetAddress): boolean {
  if (a.hasPluscode || b.hasPluscode) return false; // sin calle usable → abstenerse
  const setA = new Set(a.streetTokens);
  const setB = new Set(b.streetTokens);
  if (setA.size === 0 || setB.size === 0) return false;

  const shared = [...setA].filter((t) => setB.has(t));
  const sharedSignificant = shared.filter((t) => t.length >= 3);
  if (sharedSignificant.length === 0) return false; // exige ≥1 token "real" compartido

  // Caso fuerte: ambas puertas e iguales + token compartido ⇒ misma dirección.
  if (a.door !== null && b.door !== null && a.door === b.door) return true;

  // F2.2: un único token significativo en el lado corto, sin puerta, NO alcanza para
  // containment ("Rivera" ⊄ "Rivera Indarte": son calles distintas). Exigir >1 token en
  // el lado corto O al menos una puerta presente.
  const shortSize = Math.min(setA.size, setB.size);
  if (shortSize <= 1 && a.door === null && b.door === null) return false;

  // Caso medio: el nombre más corto está totalmente contenido en el más largo
  // (subset, ej. {rivera} ⊆ {fructuoso, rivera}), con a lo sumo una puerta presente.
  const containment = shared.length / shortSize;
  return containment >= 1.0;
}
