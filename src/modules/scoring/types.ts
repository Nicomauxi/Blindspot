export interface FieldCondition {
  field: string;
  op: "eq" | "neq" | "gte" | "lte" | "between";
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

export interface ReviewCountMultiplierRule {
  max: number | null;
  multiplier: number;
}

export interface RatingBonusConfig {
  threshold: number;
  bonus: number;
}

export interface ScoringConfig {
  version: number;
  recent_reviews_threshold_days: number;
  business_quality: Dimension;
  digital_gap: Dimension;
  mutual_exclusions: MutualExclusions;
  cap: number;
  prospect_formula: string;
  buyer_types?: BuyerTypesConfig;
  review_count_multiplier?: ReviewCountMultiplierRule[];
  rating_bonus?: RatingBonusConfig;
}

export interface EvaluatedRule {
  name: string;
  weight: number;
  matched_value: unknown;
}

export type PrimaryOffer =
  | "web_nuevo"
  | "rediseno"
  | "marketing"
  | "software"
  | "catalogo"
  | "none";

export interface SubScores {
  web_nuevo: number;
  rediseno: number;
  marketing: number;
  software: number;
  catalogo: number;
  primary_offer: PrimaryOffer;
}

export type UrgencySignal = "high" | "medium" | "low";

export interface ScoreBreakdown {
  computed_at: string;
  config_version: number;
  business_quality: { total: number; rules: EvaluatedRule[] };
  digital_gap: { total: number; rules: EvaluatedRule[] };
  systems_gap: { total: number; rules: EvaluatedRule[] };
  prospect: { formula: string; total: number };
  sub_scores: SubScores;
  urgency_signal?: UrgencySignal;
}

export type BuyerTypeSubScoreKey =
  | "web_nuevo"
  | "rediseno"
  | "marketing"
  | "software"
  | "catalogo";

export interface BuyerTypeConfig {
  formula: Record<string, number>;
  inferred_required?: Record<string, boolean>;
  niche_required?: string[];
  tag_required?: string;
  inferred_bonuses?: Record<string, number>;
  inferred_penalties?: Record<string, number>;
}

export type BuyerTypesConfig = Record<string, BuyerTypeConfig>;

export interface BuyerTypeScore {
  buyer_type: string;
  score: number;
  breakdown: {
    base: number;
    adjustments: number;
    applied_modifiers: string[];
  };
}

export interface ScoreResult {
  business_quality_score: number;
  digital_gap_score: number;
  systems_gap_score: number;
  prospect_score: number;
  score_breakdown: ScoreBreakdown;
  systems_gap_breakdown: { total: number; rules: EvaluatedRule[] };
}
