import { resolveField } from "./evaluator.js";
import { getScoringConfig } from "./config.js";
import type { Lead } from "../../shared/types.js";
import type { BuyerTypeConfig, BuyerTypeScore, CommissionEstimate } from "./types.js";

const PEDIDOSYA_COMMISSION_RATE = 0.30;

const NICHE_AVG_TICKET_UYU: Record<string, number> = {
  restaurant: 350,
  cafe: 250,
  bakery: 200,
  pharmacy: 400,
  supermarket: 600,
  pizzeria: 300,
  sushi: 450,
  burger: 320,
};

const DEFAULT_AVG_TICKET_UYU = 300;

function isPedidosYaLead(lead: Lead): boolean {
  if (lead.source === "pedidosya") return true;
  return lead.corroborating_sources?.some((s) => s.source === "pedidosya") ?? false;
}

function computeCommissionEstimate(
  lead: Lead,
  systemCostUyu: number
): CommissionEstimate {
  const reviewCount = lead.review_count ?? 0;
  const monthly_orders_est = reviewCount * 2;
  const niche = lead.niche ?? "other";
  const avg_ticket_uyu = NICHE_AVG_TICKET_UYU[niche] ?? DEFAULT_AVG_TICKET_UYU;
  const commission_monthly_uyu = Math.round(monthly_orders_est * avg_ticket_uyu * PEDIDOSYA_COMMISSION_RATE);
  const monthly_savings_est = commission_monthly_uyu - systemCostUyu;
  return {
    monthly_orders_est,
    avg_ticket_uyu,
    commission_monthly_uyu,
    system_cost_monthly_uyu: systemCostUyu,
    monthly_savings_est,
  };
}

function inferredBool(lead: Lead, field: string): boolean {
  return (
    resolveField(lead, `inferred_state.${field}.value`) === true ||
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

  const rawScore = Math.round(base + adjustments);
  const score = Math.max(0, Math.min(100, rawScore));
  return { buyer_type: buyerType, score, breakdown: { base, adjustments, applied_modifiers: modifiers } };
}

export interface BuyerScoreOpts {
  deliverySystemCostUyu?: number;
}

export function computeAllBuyerScores(lead: Lead, opts: BuyerScoreOpts = {}): BuyerTypeScore[] {
  const config = getScoringConfig();
  if (!config.buyer_types) return [];
  if (!lead.score_breakdown?.sub_scores) return [];

  return Object.entries(config.buyer_types).map(([buyerType, btConfig]) => {
    const result = computeBuyerScore(lead, buyerType, btConfig);
    if (
      buyerType === "delivery_propio" &&
      result.score > 0 &&
      isPedidosYaLead(lead) &&
      opts.deliverySystemCostUyu != null
    ) {
      const commission_estimate = computeCommissionEstimate(lead, opts.deliverySystemCostUyu);
      return {
        ...result,
        breakdown: { ...result.breakdown, commission_estimate },
      };
    }
    return result;
  });
}
