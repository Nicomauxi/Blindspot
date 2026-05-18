import type { Lead } from "../../shared/types.js";
import { calculateContactReliability, calculateDataConfidence } from "./confidence.js";
import { getScoringConfig } from "./config.js";
import { computeContactTier, CONTACTABLE_TIERS } from "./contact.js";
import { computePitchHook } from "./pitch.js";
import { getLeadInferredState, inferredBool } from "./state.js";
import { computeUrgencySignal } from "./urgency.js";
import type { ContactTier, InferredStateSummary, PrimaryOffer, SubScores, UrgencySignal } from "./types.js";

const NEW_BUSINESS_WINDOW_MS = 365 * 86_400_000;

export interface CommercialScoreSnapshot {
  prospect_score: number;
  primary_offer: PrimaryOffer;
  source_quality_bonus: number;
  contact_tier: ContactTier;
  pitch_hook: string;
  urgency_signal: UrgencySignal;
  gap_depth: number;
  commercial_breadth: number;
  business_quality_pts: number;
  accessibility_factor: number;
  timing_factor: number;
  urgency_bonus: number;
  days_in_pool: number;
  inferred_state_summary: InferredStateSummary;
  data_confidence: number;
  contact_reliability: number;
  contact_ready: boolean;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveTierPoints(value: number, tiers: Array<{ min: number; max: number | null; points: number }>): number {
  for (const tier of tiers) {
    if (value >= tier.min && (tier.max === null || value < tier.max)) {
      return tier.points;
    }
  }
  return 0;
}

function computeBusinessQualityPoints(
  lead: Lead,
  dataConfidence: number,
  contactReliability: number
): number {
  const config = getScoringConfig().commercial_score.business_quality;
  const ratingPts = lead.rating == null ? 0 : resolveTierPoints(lead.rating, config.rating_tiers);
  const reviewPts = lead.review_count == null ? 0 : resolveTierPoints(lead.review_count, config.review_tiers);
  const dataConfidencePts = Math.floor(dataConfidence * config.data_confidence_multiplier);
  const contactReliabilityPts = Math.floor(contactReliability * config.contact_reliability_multiplier);
  const corroboratingSources = Array.isArray(lead.corroborating_sources) ? lead.corroborating_sources : [];
  const corroborationPts = corroboratingSources.length >= 2 ? config.corroboration_bonus : 0;

  return Math.min(
    config.cap,
    ratingPts + reviewPts + dataConfidencePts + contactReliabilityPts + corroborationPts
  );
}

function computeAccessibilityFactor(contactTier: ContactTier, contactReliability: number): number {
  const config = getScoringConfig().commercial_score.accessibility;
  return round3(
    config.tier_base[contactTier] *
      (config.reliability_adjustment.base + config.reliability_adjustment.weight * contactReliability)
  );
}

function computeTimingFactor(
  lead: Lead,
  urgencySignal: UrgencySignal,
  competitivePressure = 0
): { factor: number; days_in_pool: number } {
  const config = getScoringConfig().commercial_score.timing;
  let factor = 1;

  if (urgencySignal === "high") {
    factor += config.urgency_high;
  }

  if (Date.now() - new Date(lead.created_at).getTime() < NEW_BUSINESS_WINDOW_MS) {
    factor += config.new_business_window;
  }

  // TODO: activar si se decide implementar geo-scoring (no hay fase asignada en ROADMAP_CANONICAL.md — agregar antes de implementar)
  factor += competitivePressure;

  if (lead.tags.includes("franchise-detected")) {
    factor += config.franchise_penalty;
  }

  const daysInPool = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86_400_000);

  if (config.days_in_pool) {
    const dip = config.days_in_pool;
    if (daysInPool < dip.fresh_threshold_days) {
      factor += dip.fresh_bonus;
    } else if (daysInPool > dip.stale_threshold_days) {
      factor += dip.stale_penalty;
    }
  }

  return { factor: round3(Math.min(config.cap, Math.max(config.floor, factor))), days_in_pool: daysInPool };
}

function computeUrgencyBonus(urgencySignal: UrgencySignal): number {
  const config = getScoringConfig().commercial_score.urgency_bonus;
  if (urgencySignal === "high") return config.high;
  if (urgencySignal === "medium") return config.medium;
  return config.low;
}

function buildInferredStateSummary(lead: Lead): InferredStateSummary {
  const state = getLeadInferredState(lead);
  return {
    has_delivery: inferredBool(state, "has_delivery"),
    has_pos: inferredBool(state, "has_pos"),
    has_reservations: inferredBool(state, "has_reservations"),
    has_ecommerce: inferredBool(state, "has_ecommerce"),
    digitalization_level: state?.digitalization_level ?? null,
  };
}

function sortedOfferScores(subScores: SubScores): Array<[Exclude<PrimaryOffer, "none">, number]> {
  const scores: Array<[Exclude<PrimaryOffer, "none">, number]> = [
    ["web_nuevo", subScores.web_nuevo],
    ["rediseno", subScores.rediseno],
    ["marketing", subScores.marketing],
    ["software", subScores.software],
    ["catalogo", subScores.catalogo],
    ["contacto_directo", subScores.contacto_directo],
  ];
  return scores.sort((left, right) => right[1] - left[1]);
}

export function computeSourceQualityBonus(source: string): number {
  const config = getScoringConfig().commercial_score.source_quality_bonus;
  return config[source] ?? 0;
}

export function computeCommercialScore(lead: Lead, subScores: SubScores): CommercialScoreSnapshot {
  const config = getScoringConfig().commercial_score;
  const urgencySignal = computeUrgencySignal(lead);
  const contactTier = computeContactTier(lead);
  const contactReliability = lead.contact_reliability_score ?? calculateContactReliability(lead);
  const dataConfidence = lead.data_confidence_score ?? calculateDataConfidence(lead);
  const sourceQualityBonus = computeSourceQualityBonus(lead.source);

  const sortedScores = sortedOfferScores(subScores);
  const topScore = sortedScores[0]?.[1] ?? 0;
  const secondScore = sortedScores[1]?.[1] ?? 0;
  const thirdScore = sortedScores[2]?.[1] ?? 0;
  const primaryOffer: PrimaryOffer = topScore > 0 ? subScores.primary_offer : "none";

  const gapDepth = Math.min(config.gap_depth_cap, topScore + sourceQualityBonus);
  const commercialBreadth =
    (secondScore >= config.commercial_breadth.secondary_threshold ? config.commercial_breadth.secondary_bonus : 0) +
    (thirdScore >= config.commercial_breadth.tertiary_threshold ? config.commercial_breadth.tertiary_bonus : 0);
  const businessQualityPts = computeBusinessQualityPoints(lead, dataConfidence, contactReliability);
  const accessibilityFactor = computeAccessibilityFactor(contactTier, contactReliability);
  const { factor: timingFactor, days_in_pool: daysInPool } = computeTimingFactor(lead, urgencySignal);
  const urgencyBonus = computeUrgencyBonus(urgencySignal);

  const prospectScore = Math.min(
    100,
    Math.floor((gapDepth + commercialBreadth + businessQualityPts) * accessibilityFactor * timingFactor) + urgencyBonus
  );

  return {
    prospect_score: prospectScore,
    primary_offer: primaryOffer,
    source_quality_bonus: sourceQualityBonus,
    contact_tier: contactTier,
    pitch_hook: computePitchHook(lead, primaryOffer),
    urgency_signal: urgencySignal,
    gap_depth: gapDepth,
    commercial_breadth: commercialBreadth,
    business_quality_pts: businessQualityPts,
    accessibility_factor: accessibilityFactor,
    timing_factor: timingFactor,
    urgency_bonus: urgencyBonus,
    days_in_pool: daysInPool,
    inferred_state_summary: buildInferredStateSummary(lead),
    data_confidence: round3(dataConfidence),
    contact_reliability: round3(contactReliability),
    contact_ready: CONTACTABLE_TIERS.has(contactTier) && prospectScore >= 30 && !lead.tags.includes("franchise-detected"),
  };
}
