import type { EvaluatedRule, ScoreBreakdown } from "./types.js";

export type ScoreBreakdownDimension = "business_quality" | "digital_gap" | "systems_gap";

export function getScoreBreakdownRules(
  breakdown: Partial<ScoreBreakdown> | null | undefined,
  dimension: ScoreBreakdownDimension
): EvaluatedRule[] {
  return breakdown?.[dimension]?.rules ?? [];
}

export const SCORE_BREAKDOWN_MATCH_RATE_SQL = `
SELECT
  rule->>'name' AS rule_name,
  rule->>'weight' AS weight,
  count(*) AS matched
FROM leads
CROSS JOIN LATERAL
  jsonb_array_elements(score_breakdown->'digital_gap'->'rules') AS rule
WHERE passed_filter = true
GROUP BY rule->>'name', rule->>'weight'
ORDER BY matched DESC;
`;
