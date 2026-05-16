import { resolveField } from "./evaluator.js";
import { getScoringConfig } from "./config.js";
import { getReviewCountMultiplier, getRatingBonus } from "./review-multiplier.js";
import type { Lead } from "../../shared/types.js";
import type { BuyerTypeConfig, BuyerTypeScore } from "./types.js";

function inferredBool(lead: Lead, field: string): boolean {
  return (
    resolveField(lead, `digital_footprint.inferred_state.${field}.value`) === true
  );
}

function computeBuyerScore(
  lead: Lead,
  buyerType: string,
  config: BuyerTypeConfig
): BuyerTypeScore {
  const subScores = lead.score_breakdown?.sub_scores;
  const noScore: BuyerTypeScore = {
    buyer_type: buyerType,
    score: 0,
    breakdown: { base: 0, adjustments: 0, applied_modifiers: [] },
  };

  if (config.tag_required && !lead.tags.includes(config.tag_required)) {
    return {
      ...noScore,
      breakdown: {
        ...noScore.breakdown,
        applied_modifiers: [`blocked:tag:${config.tag_required}`],
      },
    };
  }

  if (config.niche_required) {
    const niche = lead.niche ?? "other";
    if (!config.niche_required.includes(niche)) {
      return {
        ...noScore,
        breakdown: {
          ...noScore.breakdown,
          applied_modifiers: [`blocked:niche:${niche}`],
        },
      };
    }
  }

  if (config.inferred_required) {
    for (const [field, required] of Object.entries(config.inferred_required)) {
      const actual = inferredBool(lead, field);
      if (actual !== required) {
        return {
          ...noScore,
          breakdown: {
            ...noScore.breakdown,
            applied_modifiers: [`blocked:inferred:${field}=${String(required)}`],
          },
        };
      }
    }
  }

  let base = 0;
  for (const [key, weight] of Object.entries(config.formula)) {
    const val = subScores?.[key as keyof typeof subScores];
    if (typeof val === "number") base += val * weight;
  }
  base = Math.round(base);

  const modifiers: string[] = [];
  let adjustments = 0;

  for (const [field, bonus] of Object.entries(config.inferred_bonuses ?? {})) {
    if (inferredBool(lead, field)) {
      adjustments += bonus;
      modifiers.push(`bonus:${field}:+${bonus}`);
    }
  }

  for (const [field, penalty] of Object.entries(config.inferred_penalties ?? {})) {
    if (inferredBool(lead, field)) {
      adjustments += penalty;
      modifiers.push(`penalty:${field}:${penalty}`);
    }
  }

  const cfg = getScoringConfig();
  const reviewMultiplier = getReviewCountMultiplier(lead, cfg);
  const ratingBonus = getRatingBonus(lead, cfg);
  const rawScore = Math.round(base + adjustments);
  const score = Math.max(0, Math.min(100, Math.round(rawScore * reviewMultiplier) + ratingBonus));
  return { buyer_type: buyerType, score, breakdown: { base, adjustments, applied_modifiers: modifiers } };
}

export function computeAllBuyerScores(lead: Lead): BuyerTypeScore[] {
  const config = getScoringConfig();
  if (!config.buyer_types) return [];
  if (!lead.score_breakdown?.sub_scores) return [];

  return Object.entries(config.buyer_types).map(([buyerType, btConfig]) =>
    computeBuyerScore(lead, buyerType, btConfig)
  );
}
