import { resolveField } from "./evaluator.js";
import { getScoringConfig } from "./config.js";
import type { Lead } from "../../shared/types.js";
import type { BuyerTypeConfig, BuyerTypeScore, CommissionEstimate } from "./types.js";

const PEDIDOSYA_COMMISSION_RATE = 0.30;

export const NICHE_AVG_TICKET_UYU: Record<string, number> = {
  restaurant: 350,
  cafe: 250,
  bakery: 200,
  pharmacy: 400,
  supermarket: 600,
  pizzeria: 300,
  sushi: 450,
  burger: 320,
};

export const DEFAULT_AVG_TICKET_UYU = 300;

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
  return resolveField(lead, `inferred_state.${field}.value`) === true;
}

// N13: tri-estado — 'false' solo cuenta como ausencia VERIFICADA si el campo existe
// con confidence > 0; sin evidencia es 'unknown' (no bloquea, pero degrada).
function inferredTri(lead: Lead, field: string): boolean | "unknown" {
  const value = resolveField(lead, `inferred_state.${field}.value`);
  if (value === true) return true;
  if (value !== false) return "unknown";
  const confidence = resolveField(lead, `inferred_state.${field}.confidence`);
  return typeof confidence === "number" && confidence > 0 ? false : "unknown";
}

const UNCERTAINTY_MULTIPLIER = 0.5;
const DERIVED_WHATSAPP_MULTIPLIER = 0.7;
// BL-03: fracción de la penalización inferida que se aplica cuando el campo es 'unknown'
// (no verificado). Hedge entre 0 (premiar ignorancia, comportamiento previo) y 1 (penalizar
// como si estuviera confirmado). 0.15 = penalización suave (calibrado: con 0.3 se movían ~550
// leads de software_pos→marketing; 0.15 reduce ese desplazamiento manteniendo el anti-ignorancia).
const UNKNOWN_PENALTY_FRACTION = 0.15;

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

  // N14: con el path social muerto, whatsapp-confirmed era inalcanzable (0/9444) y el
  // buyer type computaba 9444 ceros. whatsapp-derived pasa el gate con penalización.
  let tagMultiplier = 1;
  let tagModifier: string | null = null;
  if (config.tag_required && !lead.tags.includes(config.tag_required)) {
    if (config.tag_required === "whatsapp-confirmed" && lead.tags.includes("whatsapp-derived")) {
      tagMultiplier = DERIVED_WHATSAPP_MULTIPLIER;
      tagModifier = `tag:whatsapp-derived:x${DERIVED_WHATSAPP_MULTIPLIER}`;
    } else {
      return {
        ...noScore,
        breakdown: {
          ...noScore.breakdown,
          applied_modifiers: [`blocked:tag:${config.tag_required}`],
        },
      };
    }
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

  let uncertaintyMultiplier = 1;
  const uncertaintyModifiers: string[] = [];
  if (config.inferred_required) {
    for (const [field, required] of Object.entries(config.inferred_required)) {
      const actual = inferredTri(lead, field);
      if (required === false && actual === "unknown") {
        // N13: no sabemos si lo tiene — el gate no se pasa "por falta de datos" limpio.
        uncertaintyMultiplier *= UNCERTAINTY_MULTIPLIER;
        uncertaintyModifiers.push(`uncertain:${field}`);
        continue;
      }
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

  // N08: normalizar a la escala alcanzable — sin dividir por la suma de pesos, las
  // fórmulas con pesos <1 daban avg 0-4/100 (señal degenerada).
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, weight] of Object.entries(config.formula)) {
    const val = subScores?.[key as keyof typeof subScores];
    if (typeof val === "number") weightedSum += val * weight;
    weightTotal += weight;
  }
  let base = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  // Los multiplicadores COMPONEN (derived 0.7 × uncertain 0.5 = 0.35): es intencional
  // —dos dudas valen menos que una— pero con piso 1 para no colapsar la señal a 0
  // en leads que pasaron los gates.
  const combined = tagMultiplier * uncertaintyMultiplier;
  base = combined < 1 && base > 0 ? Math.max(1, Math.round(base * combined)) : Math.round(base * combined);

  const modifiers: string[] = [...(tagModifier ? [tagModifier] : []), ...uncertaintyModifiers];
  let adjustments = 0;

  for (const [field, bonus] of Object.entries(config.inferred_bonuses ?? {})) {
    if (inferredBool(lead, field)) {
      adjustments += bonus;
      modifiers.push(`bonus:${field}:+${bonus}`);
    }
  }

  // BL-03: la penalización aplica cuando el lead YA tiene la feature (ej. has_pos → la oferta
  // software_pos es menos relevante). Con inferredBool, 'unknown' contaba como ausencia VERIFICADA
  // → un lead sin dato escapaba la penalización igual que uno confirmado-sin-la-feature ("premia
  // ignorancia"). Con inferredTri: true → penalización completa; 'unknown' → penalización SUAVE
  // (hedge por incertidumbre); false (verificado sin la feature) → sin penalización (oferta relevante).
  for (const [field, penalty] of Object.entries(config.inferred_penalties ?? {})) {
    const tri = inferredTri(lead, field);
    if (tri === true) {
      adjustments += penalty;
      modifiers.push(`penalty:${field}:${penalty}`);
    } else if (tri === "unknown") {
      const soft = Math.round(penalty * UNKNOWN_PENALTY_FRACTION);
      if (soft !== 0) {
        adjustments += soft;
        modifiers.push(`penalty:${field}:unknown:${soft}`);
      }
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
