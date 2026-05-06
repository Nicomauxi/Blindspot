import type { PlaceCandidate, DiscoveryProfile } from "../../shared/types.js";

// ---- Profile thresholds (edit here to tune) ------------------------------

interface ProfileThresholds {
  minRating: number;
  minReviews: number;
  maxReviews: number | null;
  requireNoWeb: boolean;
}

export const PROFILE_THRESHOLDS: Record<DiscoveryProfile, ProfileThresholds> = {
  a: {
    // "Joya escondida": good rating, few reviews, no/social web
    minRating: 4.3,
    minReviews: 10,
    maxReviews: 50,
    requireNoWeb: false, // we handle web check separately (null OR social domain)
  },
  b: {
    // "Saturado sin web": many reviews, completely missing web
    minRating: 0,
    minReviews: 101,
    maxReviews: null,
    requireNoWeb: true,
  },
};

const SOCIAL_DOMAINS = ["facebook.com", "instagram.com", "twitter.com", "tiktok.com"];

function isSocialOrMissingWeb(websiteUri: string | null): boolean {
  if (!websiteUri) return true;
  const lower = websiteUri.toLowerCase();
  return SOCIAL_DOMAINS.some((domain) => lower.includes(domain));
}

function isMissingWeb(websiteUri: string | null): boolean {
  return websiteUri === null || websiteUri === "";
}

// ---- Filter functions per profile ----------------------------------------

function matchesProfileA(
  candidate: PlaceCandidate,
  minRatingOverride: number
): boolean {
  const t = PROFILE_THRESHOLDS.a;
  const rating = candidate.rating ?? 0;
  const reviews = candidate.userRatingCount ?? 0;

  if (rating < Math.max(t.minRating, minRatingOverride)) return false;
  if (reviews < t.minReviews) return false;
  if (t.maxReviews !== null && reviews > t.maxReviews) return false;
  if (!isSocialOrMissingWeb(candidate.websiteUri)) return false;

  return true;
}

function matchesProfileB(
  candidate: PlaceCandidate,
  minRatingOverride: number
): boolean {
  const t = PROFILE_THRESHOLDS.b;
  const rating = candidate.rating ?? 0;
  const reviews = candidate.userRatingCount ?? 0;

  if (minRatingOverride > 0 && rating < minRatingOverride) return false;
  if (reviews < t.minReviews) return false;
  if (!isMissingWeb(candidate.websiteUri)) return false;

  return true;
}

// ---- Public API ----------------------------------------------------------

export function applyProfileFilter(
  candidates: PlaceCandidate[],
  profile: DiscoveryProfile,
  minRating: number
): PlaceCandidate[] {
  return candidates.filter((c) => {
    if (profile === "a") return matchesProfileA(c, minRating);
    return matchesProfileB(c, minRating);
  });
}

export function tagCandidate(
  candidate: PlaceCandidate,
  profile: DiscoveryProfile
): string[] {
  const tags: string[] = [`profile:${profile}`];

  if (!candidate.websiteUri) tags.push("no-web");
  else if (isSocialOrMissingWeb(candidate.websiteUri)) tags.push("social-web-only");

  if (!candidate.phone) tags.push("no-phone");

  const reviews = candidate.userRatingCount ?? 0;
  if (reviews > 100) tags.push("high-review-count");
  else if (reviews >= 10) tags.push("low-review-count");

  return tags;
}
