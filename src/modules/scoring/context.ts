import type { Lead } from "../../shared/types.js";
import { calculateDataConfidence } from "./confidence.js";
import { getScoringConfig } from "./config.js";
import { computeContactProfile, resolveContactReliability } from "./contact.js";
import { evaluateRule, resolveField } from "./evaluator.js";
import { applyMutualExclusions } from "./exclusions.js";
import { computePitchHook } from "./pitch.js";
import { calculateSubScores } from "./sub-scores.js";
import { scoreSystemsGap } from "./systems-gap.js";
import { getLeadInferredState, inferredBool } from "./state.js";
import type { ContactProfile } from "./contact.js";
import type { EvaluatedRule, InferredStateSummary, ScoringRule, SubScores, UrgencySignal } from "./types.js";
import { computeUrgencySignal } from "./urgency.js";
import { computeUrgencyProfile, type FreshnessSignal } from "./urgency-profile.js";

export interface ScoringDimensionResult {
  total: number;
  rules: EvaluatedRule[];
}

export interface LeadScoringContext {
  lead: Lead;
  computed_at: string;
  business_quality: ScoringDimensionResult;
  digital_gap: ScoringDimensionResult;
  systems_gap: ScoringDimensionResult;
  sub_scores: SubScores;
  contact_profile: ContactProfile;
  contact_reliability: number;
  data_confidence: number;
  source_quality_bonus: number;
  inferred_state_summary: InferredStateSummary;
  urgency_signal: UrgencySignal;
  business_urgency_signal: UrgencySignal;
  freshness_signal: FreshnessSignal;
  days_in_pool: number;
}

function scaleHeuristicWeight(baseWeight: number, lead: Lead): number {
  const score = resolveField(lead, "digital_footprint.heuristic_discovery.selected.website.score");
  if (typeof score !== "number") return Math.round(baseWeight * 0.3);
  if (score < 0.5) return Math.round(baseWeight * 0.3);
  if (score < 0.7) return Math.round(baseWeight * 0.6);
  return baseWeight;
}

function scoreDimension(
  rules: ScoringRule[],
  groups: string[][],
  lead: Lead,
  cap: number
): ScoringDimensionResult {
  const matched: EvaluatedRule[] = [];

  for (const rule of rules) {
    const { matched: hit, value } = evaluateRule(rule, lead);
    if (!hit) continue;
    const weight = rule.name === "website_heuristic"
      ? scaleHeuristicWeight(rule.weight, lead)
      : rule.weight;
    if (weight !== 0) matched.push({ name: rule.name, weight, matched_value: value });
  }

  const filtered = applyMutualExclusions(matched, groups);
  return {
    total: Math.max(0, Math.min(filtered.reduce((sum, rule) => sum + rule.weight, 0), cap)),
    rules: filtered,
  };
}

function computeSourceQualityBonus(source: string): number {
  const config = getScoringConfig().commercial_score.source_quality_bonus;
  return config[source] ?? 0;
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

export function computeLeadScoringContext(lead: Lead): LeadScoringContext {
  const config = getScoringConfig();
  const business_quality = scoreDimension(
    config.business_quality.rules,
    config.mutual_exclusions.business_quality,
    lead,
    config.cap
  );
  const digital_gap = scoreDimension(
    config.digital_gap.rules,
    config.mutual_exclusions.digital_gap,
    lead,
    config.cap
  );
  const systemsGap = scoreSystemsGap(lead);
  const systems_gap: ScoringDimensionResult = { total: systemsGap.total, rules: systemsGap.breakdown };
  const contact_profile = computeContactProfile(lead);
  const sub_scores = calculateSubScores(lead, Math.floor(systems_gap.total), {
    contactTier: contact_profile.tier,
  });
  const urgencyProfile = computeUrgencyProfile(lead);

  return {
    lead,
    computed_at: new Date().toISOString(),
    business_quality,
    digital_gap,
    systems_gap,
    sub_scores,
    contact_profile,
    contact_reliability: resolveContactReliability(lead),
    data_confidence: lead.data_confidence_score ?? calculateDataConfidence(lead),
    source_quality_bonus: computeSourceQualityBonus(lead.source),
    inferred_state_summary: buildInferredStateSummary(lead),
    urgency_signal: computeUrgencySignal(lead),
    business_urgency_signal: urgencyProfile.business_urgency_signal,
    freshness_signal: urgencyProfile.freshness_signal,
    days_in_pool: urgencyProfile.days_in_pool,
  };
}

export function resolveTierPoints(
  value: number,
  tiers: Array<{ min: number; max: number | null; points: number }>
): number {
  for (const tier of tiers) {
    if (value >= tier.min && (tier.max === null || value < tier.max)) return tier.points;
  }
  return 0;
}

export function computePitchHookForContext(context: LeadScoringContext, primaryOffer: SubScores["primary_offer"]): string {
  return computePitchHook(context.lead, primaryOffer);
}
