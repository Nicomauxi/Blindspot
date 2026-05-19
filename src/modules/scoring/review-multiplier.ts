import type { Lead } from "../../shared/types.js";
import type { ScoringConfig } from "./types.js";

const LEGACY_REVIEW_MULTIPLIERS = [
  { max: 10, multiplier: 0.75 },
  { max: 50, multiplier: 1.0 },
  { max: 200, multiplier: 1.2 },
  { max: null, multiplier: 1.4 },
] as const;

export function getReviewCountMultiplier(lead: Lead, _config: ScoringConfig): number {
  const count = lead.review_count;
  if (count == null) return 1.0;
  for (const rule of LEGACY_REVIEW_MULTIPLIERS) {
    if (rule.max === null || count <= rule.max) return rule.multiplier;
  }
  return 1.0;
}

export function getRatingBonus(lead: Lead, _config: ScoringConfig): number {
  if (lead.rating == null) return 0;
  return Number(lead.rating) >= 4.3 ? 5 : 0;
}
