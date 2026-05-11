export interface FieldCondition {
  field: string;
  op: "eq" | "gte" | "lte" | "between";
  value: number | string | boolean | [number, number];
}

export interface TagCondition {
  tag: string;
}

export type Condition = FieldCondition | TagCondition;

export interface ScoringRule {
  name: string;
  condition: Condition;
  weight: number;
}

export interface Dimension {
  rules: ScoringRule[];
}

export interface MutualExclusions {
  business_quality: string[][];
  digital_gap: string[][];
}

export interface ScoringConfig {
  version: number;
  recent_reviews_threshold_days: number;
  business_quality: Dimension;
  digital_gap: Dimension;
  mutual_exclusions: MutualExclusions;
  cap: number;
  prospect_formula: "business_quality * digital_gap / 100";
}

export interface EvaluatedRule {
  name: string;
  weight: number;
  matched_value: unknown;
}

export interface ScoreBreakdown {
  computed_at: string;
  config_version: number;
  business_quality: { total: number; rules: EvaluatedRule[] };
  digital_gap: { total: number; rules: EvaluatedRule[] };
  systems_gap: { total: number; rules: EvaluatedRule[] };
  prospect: { formula: string; total: number };
}

export interface ScoreResult {
  business_quality_score: number;
  digital_gap_score: number;
  systems_gap_score: number;
  prospect_score: number;
  score_breakdown: ScoreBreakdown;
  systems_gap_breakdown: { total: number; rules: EvaluatedRule[] };
}
