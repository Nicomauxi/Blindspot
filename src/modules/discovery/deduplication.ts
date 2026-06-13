import type { DiscoveryCandidate, Lead } from "../../shared/types.js";
import { extractAddressCity, haversineMeters, normalizeAddress, parseLeadGps } from "./geo-text.js";
import { doorsConflict, parseStreetAddress, streetAddressesMatch } from "./street-address.js";

const DEFAULT_GEO_RADIUS_METERS = 500;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Dos filas rodantes en vez de la matriz completa (N5.2): O(n) memoria, ~8× más rápido.
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        ai === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ratio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function tokens(name: string): string[] {
  return normalizeName(name).split(" ").filter((t) => t.length >= 2);
}

// Ratio insensible al ORDEN de palabras: ordena los tokens y compara. F2.5.
function tokenSortRatio(a: string, b: string): number {
  return ratio(tokens(a).sort().join(" "), tokens(b).sort().join(" "));
}

// Token-set ratio estilo fuzzywuzzy: alcanza 1.0 cuando un nombre es subconjunto del otro
// ("MULTICAR" ⊆ "Multicar Automotora"), sin inflar matches con tokens en conflicto. F2.5.
function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  const inter = [...setA].filter((t) => setB.has(t)).sort();
  if (inter.length === 0) return 0.0;
  const t0 = inter.join(" ");
  const t1 = [...inter, ...[...setA].filter((t) => !setB.has(t)).sort()].join(" ");
  const t2 = [...inter, ...[...setB].filter((t) => !setA.has(t)).sort()].join(" ");
  return Math.max(ratio(t0, t1), ratio(t0, t2), ratio(t1, t2));
}

// IT-05: palabras de CATEGORÍA genérica. Un nombre formado solo por estas no identifica
// un negocio puntual: "Farmacia" ⊆ "Farmacia Central" da tokenSetRatio=1.0 pero pueden ser
// negocios distintos. (Un subconjunto DISTINTIVO como "Multicar"/"La Palma" no entra acá.)
const GENERIC_BUSINESS_WORDS = new Set([
  "farmacia", "kiosco", "quiosco", "bar", "almacen", "panaderia", "carniceria", "ferreteria",
  "restaurante", "restaurant", "cafe", "cafeteria", "pizzeria", "parrilla", "peluqueria",
  "barberia", "gimnasio", "gym", "hotel", "hostal", "hostel", "supermercado", "autoservicio",
  "veterinaria", "optica", "libreria", "muebleria", "rotiseria", "heladeria", "lavadero",
  "taller", "gomeria", "estacion", "despensa", "minimercado", "mercado", "tienda", "local",
  "comercio", "deposito", "agencia", "boutique", "club",
]);

// True cuando el match de nombre proviene SOLO del path de subconjunto y el nombre menor
// es enteramente genérico ("Farmacia" ⊆ "Farmacia Central"): señal débil que exige una 2ª
// corroboración (geo) para no colapsar genéricos distintos. IT-05.
function isGenericSubsetMatch(a: string, b: string, threshold: number): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  const small = ta.length <= tb.length ? ta : tb;
  const large = ta.length <= tb.length ? tb : ta;
  if (small.length === 0 || small.length >= large.length) return false;
  const isSubset = small.every((t) => large.includes(t));
  if (!isSubset) return false;
  const allGeneric = small.every((t) => GENERIC_BUSINESS_WORDS.has(t));
  if (!allGeneric) return false;
  // Si las medidas fuertes (typos / orden) ya pasan el umbral por sí solas, no es "subset-only".
  const strong = Math.max(ratio(normalizeName(a), normalizeName(b)), tokenSortRatio(a, b));
  return strong < threshold;
}

// Corroboración geográfica POSITIVA (no la vacía de addressesCompatible): GPS dentro del
// radio (ambos presentes) o direcciones de calle que matchean estructuralmente. IT-05.
function geoPositivelyCorroborated(
  candidate: DiscoveryCandidate,
  lead: Lead,
  geoRadiusMeters: number
): boolean {
  if (candidate.latitude !== null && candidate.longitude !== null) {
    const leadGps = parseLeadGps(lead.gps);
    if (leadGps && haversineMeters({ lat: candidate.latitude, lng: candidate.longitude }, leadGps) <= geoRadiusMeters) {
      return true;
    }
  }
  return streetAddressesMatch(parseStreetAddress(candidate.address), parseStreetAddress(lead.address));
}

export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (normA.length === 0 && normB.length === 0) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0.0;
  // Combina: Levenshtein (typos), token-sort (orden de palabras) y token-set (subconjuntos). F2.5.
  return Math.max(ratio(normA, normB), tokenSortRatio(a, b), tokenSetRatio(a, b));
}

// Fuentes con niche genérico/no fiable (turismo, habilitaciones, registro industrial):
// su "other" no debe bloquear la corroboración cross-source por niche.
const WILDCARD_NICHE_SOURCES = new Set<Lead["source"]>(["mintur", "imm_habilitaciones", "miem_dei"]);

function nichesCompatible(
  candidate: Pick<DiscoveryCandidate, "niche" | "source">,
  lead: Pick<Lead, "niche" | "source">
): boolean {
  const candidateNiche = candidate.niche;
  const leadNiche = lead.niche;
  if (!candidateNiche || !leadNiche) return true;
  if (candidateNiche === leadNiche) return true;
  if (candidateNiche === "other" && WILDCARD_NICHE_SOURCES.has(candidate.source)) return true;
  if (leadNiche === "other" && WILDCARD_NICHE_SOURCES.has(lead.source)) return true;
  return candidateNiche === leadNiche;
}

function addressesCompatible(
  candidateAddress: string | null,
  leadAddress: string | null
): boolean {
  const candidateCity = extractAddressCity(candidateAddress);
  const leadCity = extractAddressCity(leadAddress);
  if (candidateCity && leadCity && candidateCity !== leadCity) return false;

  const normalizedCandidate = normalizeAddress(candidateAddress);
  const normalizedLead = normalizeAddress(leadAddress);
  if (!normalizedCandidate || !normalizedLead) return true;

  // Estructura calle + puerta para tolerar abreviaciones de prócer ("Rivera" =
  // "Gral. Fructuoso Rivera") sin colapsar sucursales de cadenas.
  const candidateStreet = parseStreetAddress(candidateAddress);
  const leadStreet = parseStreetAddress(leadAddress);

  // Bloqueo duro: dos puertas presentes y distintas ⇒ direcciones distintas (separa
  // sucursales: Devoto Rivera 4502 ≠ Devoto Arenal 2006). También corrige un over-merge
  // latente del path Levenshtein de abajo ("rivera 784" vs "rivera 2000").
  if (doorsConflict(candidateStreet, leadStreet)) return false;

  if (normalizedCandidate === normalizedLead) return true;
  if (normalizedCandidate.includes(normalizedLead) || normalizedLead.includes(normalizedCandidate)) {
    return true;
  }

  // Match estructurado: subset de tokens de calle + ancla de puerta (abreviaciones).
  if (streetAddressesMatch(candidateStreet, leadStreet)) return true;

  return nameSimilarity(normalizedCandidate, normalizedLead) >= 0.65;
}

function gpsCompatible(
  candidate: DiscoveryCandidate,
  lead: Lead,
  geoRadiusMeters: number
): boolean {
  if (candidate.latitude === null || candidate.longitude === null) return true;

  const leadGps = parseLeadGps(lead.gps);
  if (!leadGps) return true;

  const candidateGps = { lat: candidate.latitude, lng: candidate.longitude };
  return haversineMeters(candidateGps, leadGps) <= geoRadiusMeters;
}

export function findCrossSourceMatch(
  candidate: DiscoveryCandidate,
  existingLeads: Lead[],
  threshold = 0.85,
  geoRadiusMeters = DEFAULT_GEO_RADIUS_METERS
): Lead | null {
  let best: Lead | null = null;
  let bestSim = -1;

  for (const lead of existingLeads) {
    if (lead.source === candidate.source) continue;
    if (!nichesCompatible(candidate, lead)) continue;
    if (!addressesCompatible(candidate.address, lead.address)) continue;
    if (!gpsCompatible(candidate, lead, geoRadiusMeters)) continue;

    const sim = nameSimilarity(candidate.name, lead.name);
    if (sim < threshold) continue;
    // IT-05: un match de nombre que solo se sostiene por subconjunto genérico exige
    // corroboración geo positiva; sin ella, no fusiona (evita colapsar "Farmacia" distintas).
    if (isGenericSubsetMatch(candidate.name, lead.name, threshold) && !geoPositivelyCorroborated(candidate, lead, geoRadiusMeters)) {
      continue;
    }

    if (sim > bestSim) {
      best = lead;
      bestSim = sim;
    } else if (sim === bestSim && best !== null) {
      const lScore = lead.prospect_score ?? null;
      const bScore = best.prospect_score ?? null;
      if (lScore !== null && (bScore === null || lScore > bScore)) {
        best = lead;
      } else if (lScore === null && bScore === null && lead.name < best.name) {
        best = lead;
      }
    }
  }

  return best;
}

export function isFranchise(
  name: string,
  franchiseNames: ReadonlySet<string>
): boolean {
  if (franchiseNames.size === 0) return false;
  const normalized = normalizeName(name);
  for (const franchise of franchiseNames) {
    const normFranchise = normalizeName(franchise);
    // Umbral de typo escalado por la longitud de la franquicia: los nombres cortos
    // (COT, OCA) exigen match casi exacto (floor(len/4)=0..1) para no colisionar con
    // PYMEs de 3 letras; los largos toleran hasta 2 ("Farmashop 1" ≈ "Farmashop"). F2.7.
    const maxDist = Math.min(2, Math.floor(normFranchise.length / 4));
    if (levenshtein(normalized, normFranchise) <= maxDist) return true;
  }
  return false;
}
