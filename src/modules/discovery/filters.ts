import type {
  PlaceCandidate,
  ProfileConfig,
  FilterResult,
  RejectionReason,
} from "../../shared/types.js";
import { getLogger } from "../../shared/logger.js";

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

type NicheAlias = { niche: string; term: string; matchType: string };

function aliasMatches(normalized: string, alias: NicheAlias): boolean {
  const term = asciiFold(alias.term).toLowerCase();
  if (!term) return false;

  if (alias.matchType === "exact") return normalized === term;
  return normalized.includes(term);
}

export function normalizeNiche(raw: string, aliases?: readonly NicheAlias[]): string {
  const normalized = asciiFold(raw).toLowerCase();

  if (aliases && aliases.length > 0) {
    const match = aliases.find((alias) => aliasMatches(normalized, alias));
    return match?.niche ?? "other";
  }

  if (
    normalized.includes("peluquer") ||
    normalized.includes("barber") ||
    normalized.includes("hair")
  ) {
    return "hairdresser";
  }

  if (
    normalized.includes("concesion") ||
    normalized.includes("automovil") ||
    normalized.includes("auto") ||
    normalized.includes("car dealer")
  ) {
    return "car_dealer";
  }

  if (
    normalized.includes("restaurant") ||
    normalized.includes("restaurante") ||
    normalized.includes("parrilla")
  ) {
    return "restaurant";
  }

  if (
    normalized.includes("gimnasio") ||
    normalized.includes("gym") ||
    normalized.includes("fitness")
  ) {
    return "gym";
  }

  if (
    normalized.includes("clinica") ||
    normalized.includes("medic") ||
    normalized.includes("healthcare")
  ) {
    return "healthcare";
  }

  if (
    normalized.includes("farmacia") ||
    normalized.includes("pharmacy")
  ) {
    return "pharmacy";
  }

  if (
    normalized.includes("mercado") ||
    normalized.includes("supermercado") ||
    normalized.includes("grocery")
  ) {
    return "grocery";
  }

  if (
    normalized.includes("hotel") ||
    normalized.includes("hostel") ||
    normalized.includes("alojamiento") ||
    normalized.includes("hospedaje") ||
    normalized.includes("accommodation")
  ) {
    return "accommodation";
  }

  if (
    normalized.includes("dentista") ||
    normalized.includes("odontolog") ||
    normalized.includes("dentist")
  ) {
    return "dentist";
  }

  return "other";
}

export function isSocialOrMissingWeb(
  websiteUri: string | null,
  socialDomains: string[]
): boolean {
  if (!websiteUri) return true;
  const lower = websiteUri.toLowerCase();
  return socialDomains.some((domain) => lower.includes(domain));
}

export function isMissingWeb(websiteUri: string | null): boolean {
  return websiteUri === null || websiteUri === "";
}

export function applyProfileFilter(
  candidates: PlaceCandidate[],
  profileConfig: ProfileConfig,
  socialDomains: string[]
): FilterResult {
  const log = getLogger();
  const passed: PlaceCandidate[] = [];
  const rejected: Array<{ candidate: PlaceCandidate; reasons: RejectionReason[] }> = [];

  for (const candidate of candidates) {
    const reasons: RejectionReason[] = [];
    const rating = candidate.rating ?? 0;
    const reviews = candidate.userRatingCount ?? 0;

    if (rating < profileConfig.min_rating) {
      reasons.push("rating-too-low");
    }
    if (reviews < profileConfig.min_reviews) {
      reasons.push("reviews-below-min");
    }
    if (profileConfig.max_reviews !== null && reviews > profileConfig.max_reviews) {
      reasons.push("reviews-above-max");
    }

    if (profileConfig.web_requirement === "social_or_missing") {
      if (!isSocialOrMissingWeb(candidate.websiteUri, socialDomains)) {
        reasons.push("has-real-website");
      }
    } else if (profileConfig.web_requirement === "missing_only") {
      if (!isMissingWeb(candidate.websiteUri)) {
        reasons.push("has-real-website");
      }
    }
    // "any": all website types accepted — no rejection added

    log.debug({
      event: "filter.decision",
      place_id: candidate.placeId,
      name: candidate.name,
      passed: reasons.length === 0,
      reasons,
      thresholds: {
        min_rating: profileConfig.min_rating,
        min_reviews: profileConfig.min_reviews,
        max_reviews: profileConfig.max_reviews ?? null,
        web_requirement: profileConfig.web_requirement,
      },
    }, "Filter decision");

    if (reasons.length === 0) {
      passed.push(candidate);
    } else {
      rejected.push({ candidate, reasons });
    }
  }

  return { passed, rejected };
}

export function tagCandidate(
  candidate: PlaceCandidate,
  profile: string,
  socialDomains: string[]
): string[] {
  const tags: string[] = [`profile:${profile}`];
  const reviews = candidate.userRatingCount ?? 0;

  if (!candidate.websiteUri) {
    tags.push("no-website");
    if (reviews > 100) tags.push("high-reviews-no-web");
  } else {
    const lower = candidate.websiteUri.toLowerCase();
    if (lower.includes("facebook.com")) tags.push("fb-only-presence");
    else if (lower.includes("instagram.com")) tags.push("ig-only-presence");
    else if (socialDomains.some((d) => lower.includes(d))) tags.push("social-link-only");
  }

  return tags;
}
