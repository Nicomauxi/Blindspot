import type { Lead } from "../../shared/types.js";
import type { ScoringConfig } from "./types.js";

export function getReviewCountMultiplier(lead: Lead, config: ScoringConfig): number {
  const rules = config.review_count_multiplier;
  if (!rules || rules.length === 0) return 1.0;
  const count = lead.review_count;
  if (count == null) return 1.0;
  for (const rule of rules) {
    if (rule.max === null || count <= rule.max) return rule.multiplier;
  }
  return 1.0;
}

export function getRatingBonus(lead: Lead, config: ScoringConfig): number {
  if (!config.rating_bonus) return 0;
  if (lead.rating == null) return 0;
  return Number(lead.rating) >= config.rating_bonus.threshold
    ? config.rating_bonus.bonus
    : 0;
}
