import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { evaluateRule } from "./evaluator.js";
import { applyMutualExclusions } from "./exclusions.js";
import type { EvaluatedRule, ScoreResult, ScoringRule } from "./types.js";

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
      matched.push({ name: rule.name, weight: rule.weight, matched_value: value });
    }
  }

  const filtered = applyMutualExclusions(matched, groups);
  const sum = filtered.reduce((acc, r) => acc + r.weight, 0);
  return { total: Math.min(sum, cap), breakdown: filtered };
}

export function scoreLead(lead: Lead): ScoreResult {
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

  const bqScore = Math.floor(bq.total);
  const dgScore = Math.floor(dg.total);
  const prospectScore = Math.floor((bqScore * dgScore) / 100);

  return {
    business_quality_score: bqScore,
    digital_gap_score: dgScore,
    prospect_score: prospectScore,
    score_breakdown: {
      computed_at: computedAt,
      config_version: config.version,
      business_quality: { total: bqScore, rules: bq.breakdown },
      digital_gap: { total: dgScore, rules: dg.breakdown },
      prospect: { formula: config.prospect_formula, total: prospectScore },
    },
  };
}
