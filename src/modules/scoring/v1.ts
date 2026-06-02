import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { evaluateRule, resolveField } from "./evaluator.js";
import { applyMutualExclusions } from "./exclusions.js";
import { calculateSubScores } from "./sub-scores.js";
import { scoreSystemsGap } from "./systems-gap.js";
import type { EvaluatedRule, ScoreResult, ScoringRule } from "./types.js";
import { computeUrgencySignal } from "./urgency.js";

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

function contactabilityMultiplier(lead: Lead): number {
  const emailFromFootprint = (lead.digital_footprint?.contact_emails ?? []).length > 0;
  const emailFromCanonical = !!lead.canonical_fields?.["email"];
  return emailFromFootprint || emailFromCanonical ? 1.2 : 1.0;
}

export function scoreLeadV1(lead: Lead): ScoreResult {
  const config = getScoringConfig();
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
  const subScores = calculateSubScores(lead, sgScore, { includeDirectContact: false });
  const maxSubScore = Math.max(
    subScores.web_nuevo,
    subScores.rediseno,
    subScores.marketing,
    subScores.software,
    subScores.catalogo,
  );
  const prospectScore = Math.min(
    100,
    Math.floor(maxSubScore * contactabilityMultiplier(lead))
  );
  const urgencySignal = computeUrgencySignal(lead);

  return {
    business_quality_score: bqScore,
    digital_gap_score: dgScore,
    systems_gap_score: sgScore,
    prospect_score: prospectScore,
    scoring_version: 1,
    contact_ready: false,
    score_breakdown: {
      computed_at: computedAt,
      config_version: config.version,
      business_quality: { total: bqScore, rules: bq.breakdown },
      digital_gap: { total: dgScore, rules: dg.breakdown },
      systems_gap: { total: sgScore, rules: sg.breakdown },
      prospect: { formula: "max(sub_scores) * contactabilityMultiplier", total: prospectScore },
      sub_scores: subScores,
      primary_offer: subScores.primary_offer,
      source_quality_bonus: 0,
      contact_tier: "X",
      contact_score: 0,
      contact_score_signals: [],
      pitch_hook: "",
      urgency_signal: urgencySignal,
      gap_depth: 0,
      commercial_breadth: 0,
      business_quality_pts: 0,
      accessibility_factor: 0,
      timing_factor: 0,
      urgency_bonus: 0,
      days_in_pool: 0,
      inferred_state_summary: {
        has_delivery: false,
        has_pos: false,
        has_reservations: false,
        has_ecommerce: false,
        digitalization_level: null,
      },
    },
    systems_gap_breakdown: { total: sgScore, rules: sg.breakdown },
  };
}
