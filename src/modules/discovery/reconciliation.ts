import { findCrossSourceMatch, nameSimilarity, normalizeName } from "./deduplication.js";
import { extractAddressCity, haversineMeters, normalizeAddress, parseLeadGps } from "./geo-text.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../../shared/types.js";

export interface RetroactiveMatch {
  primary: Lead;
  secondary: Lead;
  similarity: number;
  source_pair: string;
  city: string | null;
  gps_distance_meters: number | null;
  phone_conflict: boolean;
  email_conflict: boolean;
}

export interface RetroactiveGroup {
  primary: Lead;
  secondaries: Lead[];
}

export interface RetroactiveReconciliationPlan {
  total_leads: number;
  threshold: number;
  geo_radius_meters: number;
  groups: RetroactiveGroup[];
  matches: RetroactiveMatch[];
  groups_with_matches: number;
  matched_secondaries: number;
  expected_remaining_leads: number;
  by_source_pair: Record<string, number>;
  phone_conflicts: number;
  email_conflicts: number;
}

function canonicalFieldValue(canonicalFields: Lead["canonical_fields"], field: "phone" | "website" | "email"): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;
  const raw = canonicalFields[field];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof raw.value === "string") {
    return raw.value;
  }
  return null;
}

function normalizePhone(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function normalizeEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return email.length > 0 ? email : null;
}

function leadToCandidate(lead: Lead): DiscoveryCandidate {
  const gps = parseLeadGps(lead.gps);
  return {
    source: lead.source,
    external_id: lead.external_id ?? lead.place_id,
    source_confidence: lead.source_confidence ?? 0.5,
    name: lead.name,
    address: lead.address,
    phone: canonicalFieldValue(lead.canonical_fields, "phone") ?? lead.phone,
    website: canonicalFieldValue(lead.canonical_fields, "website") ?? lead.website,
    email: canonicalFieldValue(lead.canonical_fields, "email"),
    latitude: gps?.lat ?? null,
    longitude: gps?.lng ?? null,
    niche: lead.niche,
    raw: lead.source_data ?? {},
  };
}

function compareLeadPriority(a: Lead, b: Lead): number {
  const byScore = (b.prospect_score ?? -1) - (a.prospect_score ?? -1);
  if (byScore !== 0) return byScore;

  const byDataConfidence = (b.data_confidence_score ?? -1) - (a.data_confidence_score ?? -1);
  if (byDataConfidence !== 0) return byDataConfidence;

  const bySourceConfidence = (b.source_confidence ?? -1) - (a.source_confidence ?? -1);
  if (bySourceConfidence !== 0) return bySourceConfidence;

  const byCreatedAt = a.created_at.localeCompare(b.created_at);
  if (byCreatedAt !== 0) return byCreatedAt;

  return a.name.localeCompare(b.name);
}

function hasFranchiseTag(lead: Lead): boolean {
  return lead.tags.includes("franchise-detected");
}

function franchiseSafeToMerge(a: Lead, b: Lead, geoRadiusMeters: number): boolean {
  if (!hasFranchiseTag(a) && !hasFranchiseTag(b)) return true;

  const addressA = normalizeAddress(a.address);
  const addressB = normalizeAddress(b.address);
  if (addressA && addressB && addressA === addressB) return true;

  const gpsA = parseLeadGps(a.gps);
  const gpsB = parseLeadGps(b.gps);
  if (gpsA && gpsB) {
    return haversineMeters(gpsA, gpsB) <= geoRadiusMeters;
  }

  return false;
}

function buildSourcePair(primary: Lead, secondary: Lead): string {
  return `${primary.source}<-${secondary.source}`;
}

function gpsDistanceMeters(primary: Lead, secondary: Lead): number | null {
  const primaryGps = parseLeadGps(primary.gps);
  const secondaryGps = parseLeadGps(secondary.gps);
  if (!primaryGps || !secondaryGps) return null;
  return Math.round(haversineMeters(primaryGps, secondaryGps));
}

function hasPhoneConflict(primary: Lead, secondary: Lead): boolean {
  const primaryPhone = normalizePhone(canonicalFieldValue(primary.canonical_fields, "phone") ?? primary.phone);
  const secondaryPhone = normalizePhone(canonicalFieldValue(secondary.canonical_fields, "phone") ?? secondary.phone);
  return primaryPhone !== null && secondaryPhone !== null && primaryPhone !== secondaryPhone;
}

function hasEmailConflict(primary: Lead, secondary: Lead): boolean {
  const primaryEmail = normalizeEmail(canonicalFieldValue(primary.canonical_fields, "email"));
  const secondaryEmail = normalizeEmail(canonicalFieldValue(secondary.canonical_fields, "email"));
  return primaryEmail !== null && secondaryEmail !== null && primaryEmail !== secondaryEmail;
}

function chooseBestKeeper(
  lead: Lead,
  keepers: Lead[],
  threshold: number,
  geoRadiusMeters: number
): Lead | null {
  const candidate = leadToCandidate(lead);
  let best: Lead | null = null;
  let bestSimilarity = -1;

  for (const keeper of keepers) {
    const match = findCrossSourceMatch(candidate, [keeper], threshold, geoRadiusMeters);
    if (!match) continue;
    if (!franchiseSafeToMerge(lead, keeper, geoRadiusMeters)) continue;

    const similarity = nameSimilarity(lead.name, keeper.name);
    if (similarity > bestSimilarity) {
      best = keeper;
      bestSimilarity = similarity;
      continue;
    }

    if (similarity === bestSimilarity && best !== null && compareLeadPriority(keeper, best) < 0) {
      best = keeper;
    }
  }

  return best;
}

export function buildRetroactiveReconciliationPlan(
  leads: Lead[],
  opts: { threshold: number; geoRadiusMeters: number }
): RetroactiveReconciliationPlan {
  const ordered = leads.slice().sort(compareLeadPriority);
  const keepers: Lead[] = [];
  const groups = new Map<string, RetroactiveGroup>();
  const matches: RetroactiveMatch[] = [];
  const bySourcePair = new Map<string, number>();

  for (const lead of ordered) {
    const keeper = chooseBestKeeper(lead, keepers, opts.threshold, opts.geoRadiusMeters);
    if (!keeper) {
      keepers.push(lead);
      groups.set(lead.id, { primary: lead, secondaries: [] });
      continue;
    }

    const group = groups.get(keeper.id);
    if (!group) {
      throw new Error(`Missing retroactive group for primary lead ${keeper.id}`);
    }

    group.secondaries.push(lead);
    const sourcePair = buildSourcePair(keeper, lead);
    bySourcePair.set(sourcePair, (bySourcePair.get(sourcePair) ?? 0) + 1);
    matches.push({
      primary: keeper,
      secondary: lead,
      similarity: Number(nameSimilarity(lead.name, keeper.name).toFixed(4)),
      source_pair: sourcePair,
      city: extractAddressCity(lead.address) ?? extractAddressCity(keeper.address),
      gps_distance_meters: gpsDistanceMeters(keeper, lead),
      phone_conflict: hasPhoneConflict(keeper, lead),
      email_conflict: hasEmailConflict(keeper, lead),
    });
  }

  const finalGroups = Array.from(groups.values())
    .filter((group) => group.secondaries.length > 0)
    .sort((a, b) => compareLeadPriority(a.primary, b.primary));

  const phoneConflicts = matches.filter((match) => match.phone_conflict).length;
  const emailConflicts = matches.filter((match) => match.email_conflict).length;
  const bySourcePairObject = Object.fromEntries(
    Array.from(bySourcePair.entries()).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    total_leads: leads.length,
    threshold: opts.threshold,
    geo_radius_meters: opts.geoRadiusMeters,
    groups: finalGroups,
    matches,
    groups_with_matches: finalGroups.length,
    matched_secondaries: matches.length,
    expected_remaining_leads: leads.length - matches.length,
    by_source_pair: bySourcePairObject,
    phone_conflicts: phoneConflicts,
    email_conflicts: emailConflicts,
  };
}

export function describeRetroactiveGroup(group: RetroactiveGroup): string {
  const primaryName = normalizeName(group.primary.name);
  const sourceList = [group.primary.source, ...group.secondaries.map((lead) => lead.source)].join(", ");
  return `${primaryName} [${sourceList}]`;
}
