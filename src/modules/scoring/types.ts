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

export interface RangePointsRule {
  min: number;
  max: number | null;
  points: number;
}

export interface SourceQualityBonusConfig {
  google_places?: number;
  osm?: number;
  yelu?: number;
  pedidosya?: number;
  mintur?: number;
  [key: string]: number | undefined;
}

export interface CommercialBreadthConfig {
  secondary_threshold: number;
  secondary_bonus: number;
  tertiary_threshold: number;
  tertiary_bonus: number;
}

export interface BusinessQualityPointsConfig {
  rating_tiers: RangePointsRule[];
  review_tiers: RangePointsRule[];
  data_confidence_multiplier: number;
  contact_reliability_multiplier: number;
  corroboration_bonus: number;
  cap: number;
}

export interface AccessibilityConfig {
  tier_base: Record<ContactTier, number>;
  reliability_adjustment: {
    base: number;
    weight: number;
  };
  score_adjustment: {
    base: number;
    weight: number;
  };
  contact_score: {
    weights: {
      email: number;
      extra_email: number;
      whatsapp_direct: number;
      whatsapp_derived: number;
      phone: number;
      phone_confirmed_bonus: number;
      address: number;
      website: number;
      contact_form: number;
      social_dm_channel: number;
      whatsapp_web_link: number;
      multi_channel_bonus: number;
      high_confidence_bonus: number;
    };
    thresholds: Record<Exclude<ContactTier, "X">, number>;
    cap: number;
  };
}

export interface DaysInPoolConfig {
  fresh_threshold_days: number;
  fresh_bonus: number;
  stale_threshold_days: number;
  stale_penalty: number;
}

export interface TimingConfig {
  urgency_high: number;
  new_business_window: number;
  competitive_pressure_isolated: number;
  franchise_penalty: number;
  cap: number;
  floor: number;
  days_in_pool?: DaysInPoolConfig;
}

export interface UrgencyBonusConfig {
  high: number;
  medium: number;
  low: number;
}

export interface CommercialScoreConfig {
  gap_depth_cap: number;
  source_quality_bonus: SourceQualityBonusConfig;
  commercial_breadth: CommercialBreadthConfig;
  business_quality: BusinessQualityPointsConfig;
  accessibility: AccessibilityConfig;
  timing: TimingConfig;
  urgency_bonus: UrgencyBonusConfig;
}

export type ScoreModelFamily =
  | "multiplicative_attenuated"
  | "additive_pure"
  | "hybrid_bounded";

export interface VerticalOfferAdjustment {
  multiplier?: number;
  cap?: number;
}

export interface ScoreBandThresholds {
  normal_max: number;
  good_min: number;
  very_good_min: number;
  exceptional_min: number;
}

export interface DedupeCalibrationConfig {
  possible_duplicate_penalty: number;
  duplicate_secondary_penalty: number;
  block_duplicate_secondary_exceptional: boolean;
}

export interface ScoreCalibrationScenario {
  family: ScoreModelFamily;
  gap_depth_cap: number;
  source_quality_bonus: SourceQualityBonusConfig;
  commercial_breadth: CommercialBreadthConfig;
  business_quality: {
    rating_tiers: RangePointsRule[];
    review_tiers: RangePointsRule[];
    data_confidence_multiplier: number;
    contact_reliability_multiplier: number;
    corroboration_bonus: number;
    cap: number;
  };
  accessibility: {
    bounded_bonus_by_tier: Record<ContactTier, number>;
    score_tiers: Array<{ min: number; points: number }>;
    multiplicative_multiplier_by_tier: Record<ContactTier, number>;
    score_multiplier_weight: number;
    reliability_multiplier_weight: number;
  };
  timing: {
    high_urgency_bonus: number;
    medium_urgency_bonus: number;
    low_urgency_bonus: number;
    franchise_penalty: number;
    freshness_bonus: number;
    stale_penalty: number;
  };
  offer_adjustments?: Partial<Record<Exclude<PrimaryOffer, "none">, VerticalOfferAdjustment>>;
  catalogo_by_niche?: Record<string, VerticalOfferAdjustment>;
  preview_thresholds?: ScoreBandThresholds;
  dedupe?: DedupeCalibrationConfig;
}

export interface ScoreCalibrationConfig {
  version: number;
  default_scenario: string;
  scenarios: Record<string, ScoreCalibrationScenario>;
}

export interface ThresholdsConfig {
  hot: number;
  pitcheable: number;
  pool: number;
}

export interface PitchHookOverrideWhen {
  has_delivery?: boolean;
  has_pos?: boolean;
  has_reservations?: boolean;
  has_ecommerce?: boolean;
  niche?: string;
}

export interface PitchHookOverride {
  when: PitchHookOverrideWhen;
  text: string;
}

export interface PitchHookConfig {
  default: string;
  overrides?: PitchHookOverride[];
}

export interface ScoringConfig {
  version: number;
  recent_reviews_threshold_days: number;
  business_quality: Dimension;
  digital_gap: Dimension;
  mutual_exclusions: MutualExclusions;
  cap: number;
  prospect_formula: string;
  commercial_score: CommercialScoreConfig;
  thresholds: ThresholdsConfig;
  pitch_hooks: Record<Exclude<PrimaryOffer, "none">, PitchHookConfig>;
  buyer_types?: BuyerTypesConfig;
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
  | "contacto_directo"
  | "none";

export type ContactTier = "A" | "B" | "C" | "D" | "X";

export interface SubScores {
  web_nuevo: number;
  rediseno: number;
  marketing: number;
  software: number;
  catalogo: number;
  contacto_directo: number;
  primary_offer: PrimaryOffer;
}

export type UrgencySignal = "high" | "medium" | "low";

export interface InferredStateSummary {
  has_delivery: boolean;
  has_pos: boolean;
  has_reservations: boolean;
  has_ecommerce: boolean;
  digitalization_level: string | null;
}

export interface ContactScoreSignal {
  name: string;
  weight: number;
  value: string | number | boolean | null;
}

export interface ScoreBreakdown {
  computed_at: string;
  config_version: number;
  business_quality: { total: number; rules: EvaluatedRule[] };
  digital_gap: { total: number; rules: EvaluatedRule[] };
  systems_gap: { total: number; rules: EvaluatedRule[] };
  prospect: { formula: string; total: number };
  sub_scores: SubScores;
  primary_offer: PrimaryOffer;
  source_quality_bonus: number;
  contact_tier: ContactTier;
  contact_score: number;
  contact_score_signals: ContactScoreSignal[];
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
  score_model?: ScoreModelFamily;
  score_band?: "normal" | "bueno" | "muy_bueno" | "excepcional";
  business_urgency_signal?: UrgencySignal;
  freshness_signal?: "fresh" | "stale" | "neutral";
  accessibility_bonus?: number;
  timing_bonus?: number;
  dedupe_penalty?: number;
}

export type BuyerTypeSubScoreKey =
  | "web_nuevo"
  | "rediseno"
  | "marketing"
  | "software"
  | "catalogo"
  | "contacto_directo";

export interface BuyerTypeConfig {
  formula: Record<string, number>;
  inferred_required?: Record<string, boolean>;
  niche_required?: string[];
  tag_required?: string;
  inferred_bonuses?: Record<string, number>;
  inferred_penalties?: Record<string, number>;
}

export type BuyerTypesConfig = Record<string, BuyerTypeConfig>;

export interface CommissionEstimate {
  monthly_orders_est: number;
  avg_ticket_uyu: number;
  commission_monthly_uyu: number;
  system_cost_monthly_uyu: number;
  monthly_savings_est: number;
}

export interface BuyerTypeScore {
  buyer_type: string;
  score: number;
  breakdown: {
    base: number;
    adjustments: number;
    applied_modifiers: string[];
    commission_estimate?: CommissionEstimate;
  };
}

export interface ScoreResult {
  business_quality_score: number;
  digital_gap_score: number;
  systems_gap_score: number;
  prospect_score: number;
  scoring_version: number;
  contact_ready: boolean;
  score_breakdown: ScoreBreakdown;
  systems_gap_breakdown: { total: number; rules: EvaluatedRule[] };
}

export interface LeadScoreSnapshot {
  lead_id: string;
  snapshot_label: string;
  scoring_version: number;
  prospect_score: number | null;
  score_breakdown: Record<string, unknown> | null;
  contact_ready: boolean | null;
  captured_at: string;
}
