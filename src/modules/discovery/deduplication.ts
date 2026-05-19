import type { DiscoveryCandidate, Lead } from "../../shared/types.js";

const DEFAULT_GEO_RADIUS_METERS = 500;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
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

export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (normA.length === 0 && normB.length === 0) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0.0;
  const dist = levenshtein(normA, normB);
  return 1 - dist / Math.max(normA.length, normB.length);
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(avenida|av|calle|ruta|km|kilometro|numero|nro|esquina)\b/g, " ")
    .replace(/[^a-z0-9,]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function extractAddressCity(value: string | null | undefined): string | null {
  const normalized = normalizeAddress(value);
  if (!normalized) return null;

  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1] ?? null;

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
    if (normalized.includes(hint)) return hint;
  }

  return null;
}

const WILDCARD_NICHE_SOURCES = new Set<Lead["source"]>(["mintur", "imm_habilitaciones"]);

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

  if (normalizedCandidate === normalizedLead) return true;
  if (normalizedCandidate.includes(normalizedLead) || normalizedLead.includes(normalizedCandidate)) {
    return true;
  }

  return nameSimilarity(normalizedCandidate, normalizedLead) >= 0.65;
}

function parseLeadGps(gps: Lead["gps"]): { lat: number; lng: number } | null {
  if (!gps) return null;

  if (typeof gps === "string") {
    const match = gps.match(/POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/);
    if (match) {
      return {
        lng: Number(match[1]),
        lat: Number(match[2]),
      };
    }
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
}

function haversineMeters(
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
  const h = sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
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
    if (levenshtein(normalized, normalizeName(franchise)) <= 2) return true;
  }
  return false;
}
