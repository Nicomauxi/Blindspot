import type { DiscoveryCandidate, Lead } from "../../shared/types.js";
import { extractAddressCity, haversineMeters, normalizeAddress, parseLeadGps } from "./geo-text.js";

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
