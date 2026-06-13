import type { Lead } from "../../shared/types.js";
import { CONTACTABLE_TIERS } from "./contact.js";
import { getScoringConfig } from "./config.js";
import type { LeadScoringContext } from "./context.js";
import { computeLeadScoringContext, computePitchHookForContext, resolveTierPoints } from "./context.js";
import { computeSocialBonus, computeSocialSignal } from "./social-signal.js";
import type { PrimaryOffer, ScoreBandThresholds, ScoreCalibrationScenario, ScoreModelFamily, ScoreResult, SubScores, UrgencySignal } from "./types.js";

export interface CommercialScoreV3Snapshot {
  prospect_score: number;
  primary_offer: PrimaryOffer;
  /** N04/N11: sub-scores AJUSTADOS (multiplicadores/caps del escenario) — los que decidieron primary_offer. */
  sub_scores_adjusted: SubScores;
  contact_ready: boolean;
  contact_tier: ReturnType<typeof computeLeadScoringContext>["contact_profile"]["tier"];
  contact_score: number;
  contact_score_signals: ReturnType<typeof computeLeadScoringContext>["contact_profile"]["signals"];
  pitch_hook: string;
  gap_depth: number;
  commercial_breadth: number;
  business_quality_pts: number;
  source_quality_bonus: number;
  accessibility_bonus: number;
  timing_bonus: number;
  social_bonus: number;
  dedupe_penalty: number;
  score_band: "normal" | "bueno" | "muy_bueno" | "excepcional";
  score_model: ScoreModelFamily;
  business_urgency_signal: UrgencySignal;
  freshness_signal: LeadScoringContext["freshness_signal"];
  days_in_pool: number;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(99, Math.floor(value)));
}

function adjustOfferScore(lead: Lead, offer: Exclude<PrimaryOffer, "none">, score: number, scenario: ScoreCalibrationScenario): number {
  let next = score;
  const generic = scenario.offer_adjustments?.[offer];
  if (generic?.multiplier != null) next = next * generic.multiplier;
  if (generic?.cap != null) next = Math.min(next, generic.cap);

  if (offer === "catalogo") {
    const niche = lead.niche ?? "other";
    const catalogo = scenario.catalogo_by_niche?.[niche];
    if (catalogo?.multiplier != null) next = next * catalogo.multiplier;
    if (catalogo?.cap != null) next = Math.min(next, catalogo.cap);
  }

  return Math.max(0, Math.round(next));
}

function buildAdjustedSubScores(context: LeadScoringContext, scenario: ScoreCalibrationScenario): SubScores {
  const source = context.sub_scores;
  const adjusted: SubScores = {
    web_nuevo: adjustOfferScore(context.lead, "web_nuevo", source.web_nuevo, scenario),
    rediseno: adjustOfferScore(context.lead, "rediseno", source.rediseno, scenario),
    marketing: adjustOfferScore(context.lead, "marketing", source.marketing, scenario),
    software: adjustOfferScore(context.lead, "software", source.software, scenario),
    catalogo: adjustOfferScore(context.lead, "catalogo", source.catalogo, scenario),
    contacto_directo: adjustOfferScore(context.lead, "contacto_directo", source.contacto_directo, scenario),
    primary_offer: "none",
  };

  const ranked: Array<[Exclude<PrimaryOffer, "none">, number]> = [
    ["web_nuevo", adjusted.web_nuevo],
    ["rediseno", adjusted.rediseno],
    ["marketing", adjusted.marketing],
    ["software", adjusted.software],
    ["catalogo", adjusted.catalogo],
    ["contacto_directo", adjusted.contacto_directo],
  ];
  ranked.sort((left, right) => right[1] - left[1]);
  adjusted.primary_offer = (ranked[0]?.[1] ?? 0) > 0 ? ranked[0]![0] : "none";
  return adjusted;
}

function computeBusinessQualityPoints(context: LeadScoringContext, scenario: ScoreCalibrationScenario): number {
  const lead = context.lead;
  const ratingPts = lead.rating == null ? 0 : resolveTierPoints(lead.rating, scenario.business_quality.rating_tiers);
  const reviewPts = lead.review_count == null ? 0 : resolveTierPoints(lead.review_count, scenario.business_quality.review_tiers);
  const dataConfidencePts = Math.floor(context.data_confidence * scenario.business_quality.data_confidence_multiplier);
  const contactReliabilityPts = Math.floor(context.contact_reliability * scenario.business_quality.contact_reliability_multiplier);
  const corroborationPts = (lead.corroborating_sources?.length ?? 0) >= 2 ? scenario.business_quality.corroboration_bonus : 0;
  return Math.min(scenario.business_quality.cap, ratingPts + reviewPts + dataConfidencePts + contactReliabilityPts + corroborationPts);
}

function computeAccessibilityBonus(context: LeadScoringContext, scenario: ScoreCalibrationScenario): number {
  let bonus = scenario.accessibility.bounded_bonus_by_tier[context.contact_profile.tier];
  for (const tier of scenario.accessibility.score_tiers) {
    if (context.contact_profile.score >= tier.min) bonus = bonus + tier.points;
  }
  return Math.round(bonus);
}

function computeMultipliers(context: LeadScoringContext, scenario: ScoreCalibrationScenario): { access: number; timing: number } {
  const access = scenario.accessibility.multiplicative_multiplier_by_tier[context.contact_profile.tier]
    * (1 + (context.contact_profile.score / 100) * scenario.accessibility.score_multiplier_weight)
    * (1 + context.contact_reliability * scenario.accessibility.reliability_multiplier_weight);

  let timing = 1;
  if (context.business_urgency_signal === "high") timing += scenario.timing.high_urgency_bonus / 100;
  else if (context.business_urgency_signal === "medium") timing += scenario.timing.medium_urgency_bonus / 100;
  else timing += scenario.timing.low_urgency_bonus / 100;

  if (context.freshness_signal === "fresh") timing += scenario.timing.freshness_bonus / 100;
  else if (context.freshness_signal === "stale") timing += scenario.timing.stale_penalty / 100;
  if (context.lead.tags.includes("franchise-detected")) timing += scenario.timing.franchise_penalty / 100;

  return {
    access: Math.max(0.25, Math.min(1.5, access)),
    timing: Math.max(0.65, Math.min(1.35, timing)),
  };
}

function computeScenarioSourceQualityBonus(lead: Lead, scenario: ScoreCalibrationScenario): number {
  return scenario.source_quality_bonus[lead.source] ?? 0;
}

function computeDedupePenalty(lead: Lead, scenario: ScoreCalibrationScenario): number {
  const dedupe = scenario.dedupe;
  if (!dedupe) return 0;
  if (lead.tags.includes("duplicate-secondary")) return dedupe.duplicate_secondary_penalty;
  if (lead.tags.includes("possible-duplicate")) return dedupe.possible_duplicate_penalty;
  return 0;
}

function computeTimingBonus(context: LeadScoringContext, scenario: ScoreCalibrationScenario): number {
  let bonus = 0;
  if (context.business_urgency_signal === "high") bonus += scenario.timing.high_urgency_bonus;
  else if (context.business_urgency_signal === "medium") bonus += scenario.timing.medium_urgency_bonus;
  else bonus += scenario.timing.low_urgency_bonus;

  if (context.freshness_signal === "fresh") bonus += scenario.timing.freshness_bonus;
  else if (context.freshness_signal === "stale") bonus += scenario.timing.stale_penalty;
  if (context.lead.tags.includes("franchise-detected")) bonus += scenario.timing.franchise_penalty;
  return Math.round(bonus);
}

export function resolveScoreBand(score: number, thresholds: ScoreBandThresholds): CommercialScoreV3Snapshot["score_band"] {
  if (score >= thresholds.exceptional_min) return "excepcional";
  if (score >= thresholds.very_good_min) return "muy_bueno";
  if (score >= thresholds.good_min) return "bueno";
  return "normal";
}

export function simulateCommercialScoreV3(
  lead: Lead,
  scenario: ScoreCalibrationScenario,
  thresholds: ScoreBandThresholds = scenario.preview_thresholds ?? { normal_max: 34, good_min: 35, very_good_min: 55, exceptional_min: 75 },
  providedContext?: LeadScoringContext,
): CommercialScoreV3Snapshot {
  const context = providedContext ?? computeLeadScoringContext(lead);
  const adjustedSubScores = buildAdjustedSubScores(context, scenario);
  const offerValues = [adjustedSubScores.web_nuevo, adjustedSubScores.rediseno, adjustedSubScores.marketing, adjustedSubScores.software, adjustedSubScores.catalogo, adjustedSubScores.contacto_directo].sort((a, b) => b - a);
  const topScore = offerValues[0] ?? 0;
  const secondScore = offerValues[1] ?? 0;
  const thirdScore = offerValues[2] ?? 0;
  const primaryOffer = topScore > 0 ? adjustedSubScores.primary_offer : "none";

  const gapDepth = Math.min(scenario.gap_depth_cap, topScore);
  const commercialBreadth = (secondScore >= scenario.commercial_breadth.secondary_threshold ? scenario.commercial_breadth.secondary_bonus : 0)
    + (thirdScore >= scenario.commercial_breadth.tertiary_threshold ? scenario.commercial_breadth.tertiary_bonus : 0);
  const businessQualityPts = computeBusinessQualityPoints(context, scenario);
  const accessibilityBonus = computeAccessibilityBonus(context, scenario);
  const timingBonus = computeTimingBonus(context, scenario);
  const sourceQualityBonus = computeScenarioSourceQualityBonus(lead, scenario);
  const dedupePenalty = computeDedupePenalty(lead, scenario);
  // F1: bonus por señal social (audiencia/actividad/audiencia-sin-web). Entra al base como
  // un término aditivo más, igual que source_quality_bonus.
  const socialBonus = computeSocialBonus(computeSocialSignal(lead), scenario.social);
  const base = gapDepth + commercialBreadth + businessQualityPts + sourceQualityBonus + socialBonus;

  let score = 0;
  if (scenario.family === "additive_pure") {
    score = base + accessibilityBonus + timingBonus;
  } else if (scenario.family === "hybrid_bounded") {
    score = base + accessibilityBonus + timingBonus;
  } else {
    const multipliers = computeMultipliers(context, scenario);
    score = (base + Math.max(0, accessibilityBonus)) * multipliers.access * multipliers.timing + Math.min(0, accessibilityBonus) + timingBonus;
  }

  score -= dedupePenalty;
  let prospectScore = clampScore(score);
  if (scenario.dedupe?.block_duplicate_secondary_exceptional && lead.tags.includes("duplicate-secondary") && prospectScore >= thresholds.exceptional_min) {
    prospectScore = Math.max(0, thresholds.exceptional_min - 1);
  }
  const scoreBand = resolveScoreBand(prospectScore, thresholds);
  const hotThreshold = thresholds.good_min ?? getScoringConfig().thresholds.pitcheable;

  return {
    prospect_score: prospectScore,
    primary_offer: primaryOffer,
    contact_ready: CONTACTABLE_TIERS.has(context.contact_profile.tier) && prospectScore >= hotThreshold && !lead.tags.includes("franchise-detected"),
    sub_scores_adjusted: adjustedSubScores,
    contact_tier: context.contact_profile.tier,
    contact_score: context.contact_profile.score,
    contact_score_signals: context.contact_profile.signals,
    pitch_hook: computePitchHookForContext(context, primaryOffer),
    gap_depth: gapDepth,
    commercial_breadth: commercialBreadth,
    business_quality_pts: businessQualityPts,
    source_quality_bonus: sourceQualityBonus,
    accessibility_bonus: accessibilityBonus,
    timing_bonus: timingBonus,
    social_bonus: socialBonus,
    dedupe_penalty: dedupePenalty,
    score_band: scoreBand,
    score_model: scenario.family,
    business_urgency_signal: context.business_urgency_signal,
    freshness_signal: context.freshness_signal,
    days_in_pool: context.days_in_pool,
  };
}

export function buildScoreResultV3(lead: Lead, scenario: ScoreCalibrationScenario, thresholds?: ScoreBandThresholds): ScoreResult {
  const context = computeLeadScoringContext(lead);
  const snapshot = simulateCommercialScoreV3(lead, scenario, thresholds, context);

  return {
    business_quality_score: Math.floor(context.business_quality.total),
    digital_gap_score: Math.floor(context.digital_gap.total),
    systems_gap_score: Math.floor(context.systems_gap.total),
    prospect_score: snapshot.prospect_score,
    scoring_version: 3,
    contact_ready: snapshot.contact_ready,
    score_breakdown: {
      computed_at: context.computed_at,
      config_version: getScoringConfig().version,
      business_quality: { total: Math.floor(context.business_quality.total), rules: context.business_quality.rules },
      digital_gap: { total: Math.floor(context.digital_gap.total), rules: context.digital_gap.rules },
      systems_gap: { total: Math.floor(context.systems_gap.total), rules: context.systems_gap.rules },
      prospect: { formula: "commercial_score_v3", total: snapshot.prospect_score },
      // N04/N11: ajustados = fuente de verdad para ranking de ofertas/buyers; los
      // crudos quedan para debugging.
      sub_scores: snapshot.sub_scores_adjusted,
      sub_scores_raw: context.sub_scores,
      primary_offer: snapshot.primary_offer,
      source_quality_bonus: snapshot.source_quality_bonus,
      contact_tier: snapshot.contact_tier,
      contact_score: snapshot.contact_score,
      contact_score_signals: snapshot.contact_score_signals,
      pitch_hook: snapshot.pitch_hook,
      urgency_signal: context.urgency_signal,
      gap_depth: snapshot.gap_depth,
      commercial_breadth: snapshot.commercial_breadth,
      business_quality_pts: snapshot.business_quality_pts,
      days_in_pool: snapshot.days_in_pool,
      inferred_state_summary: context.inferred_state_summary,
      score_model: snapshot.score_model,
      score_band: snapshot.score_band,
      business_urgency_signal: snapshot.business_urgency_signal,
      freshness_signal: snapshot.freshness_signal,
      accessibility_bonus: snapshot.accessibility_bonus,
      timing_bonus: snapshot.timing_bonus,
      social_bonus: snapshot.social_bonus,
      dedupe_penalty: snapshot.dedupe_penalty,
      accessibility_factor: 0,
      timing_factor: 0,
      urgency_bonus: 0,
    },
    systems_gap_breakdown: { total: Math.floor(context.systems_gap.total), rules: context.systems_gap.rules },
  };
}
