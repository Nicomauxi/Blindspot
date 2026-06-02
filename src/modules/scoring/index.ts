import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { evaluateRule, resolveField } from "./evaluator.js";
import { applyMutualExclusions } from "./exclusions.js";
import { computeContactTier } from "./contact.js";
import { calculateSubScores } from "./sub-scores.js";
import { scoreSystemsGap } from "./systems-gap.js";
import type { EvaluatedRule, ScoreResult, ScoringRule } from "./types.js";
import { computeCommercialScore } from "./v2.js";
import { getScoringCalibrationConfig } from "./calibration-config.js";
import { buildScoreResultV3 } from "./v3.js";
export { scoreLeadV1 } from "./v1.js";

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
): { total: number; breakdown: EvaluatedRule[] } {
  const matched: EvaluatedRule[] = [];

  for (const rule of rules) {
    const { matched: hit, value } = evaluateRule(rule, lead);
    if (hit) {
      const weight = rule.name === "website_heuristic"
        ? scaleHeuristicWeight(rule.weight, lead)
        : rule.weight;
      if (weight !== 0) {
        matched.push({ name: rule.name, weight, matched_value: value });
      }
    }
  }

  const filtered = applyMutualExclusions(matched, groups);
  const sum = filtered.reduce((acc, r) => acc + r.weight, 0);
  return { total: Math.max(0, Math.min(sum, cap)), breakdown: filtered };
}

export function scoreLead(lead: Lead): ScoreResult {
  const config = getScoringConfig();
  if (config.prospect_formula === "commercial_score_v3") {
    const calibration = getScoringCalibrationConfig();
    const scenario = calibration.scenarios[calibration.default_scenario];
    if (!scenario) {
      throw new Error(`Missing default calibration scenario: ${calibration.default_scenario}`);
    }
    return buildScoreResultV3(lead, scenario, scenario.preview_thresholds);
  }

  const computedAt = new Date().toISOString();

  const bq = scoreDimension(
    config.business_quality.rules,
    config.mutual_exclusions.business_quality,
    lead,
    config.cap
  );

  const dg = scoreDimension(
    config.digital_gap.rules,
    config.mutual_exclusions.digital_gap,
    lead,
    config.cap
  );
  const sg = scoreSystemsGap(lead);

  const bqScore = Math.floor(bq.total);
  const dgScore = Math.floor(dg.total);
  const sgScore = Math.floor(sg.total);

  const subScores = calculateSubScores(lead, sgScore, {
    contactTier: computeContactTier(lead),
  });
  const commercial = computeCommercialScore(lead, subScores);

  return {
    business_quality_score: bqScore,
    digital_gap_score: dgScore,
    systems_gap_score: sgScore,
    prospect_score: commercial.prospect_score,
    scoring_version: 2,
    contact_ready: commercial.contact_ready,
    score_breakdown: {
      computed_at: computedAt,
      config_version: config.version,
      business_quality: { total: bqScore, rules: bq.breakdown },
      digital_gap: { total: dgScore, rules: dg.breakdown },
      systems_gap: { total: sgScore, rules: sg.breakdown },
      prospect: { formula: config.prospect_formula, total: commercial.prospect_score },
      sub_scores: subScores,
      primary_offer: commercial.primary_offer,
      source_quality_bonus: commercial.source_quality_bonus,
      contact_tier: commercial.contact_tier,
      contact_score: commercial.contact_score,
      contact_score_signals: commercial.contact_score_signals,
      pitch_hook: commercial.pitch_hook,
      urgency_signal: commercial.urgency_signal,
      gap_depth: commercial.gap_depth,
      commercial_breadth: commercial.commercial_breadth,
      business_quality_pts: commercial.business_quality_pts,
      accessibility_factor: commercial.accessibility_factor,
      timing_factor: commercial.timing_factor,
      urgency_bonus: commercial.urgency_bonus,
      days_in_pool: commercial.days_in_pool,
      inferred_state_summary: commercial.inferred_state_summary,
    },
    systems_gap_breakdown: { total: sgScore, rules: sg.breakdown },
  };
}
