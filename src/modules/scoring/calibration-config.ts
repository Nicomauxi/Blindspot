import { readFileSync } from "fs";
import { load } from "js-yaml";
import { z } from "zod";
import type { ScoreCalibrationConfig } from "./types.js";

const ContactTierSchema = z.enum(["A", "B", "C", "D", "X"]);

const RangePointsRuleSchema = z.object({
  min: z.number(),
  max: z.number().nullable(),
  points: z.number(),
});

const SourceQualityBonusSchema = z.record(z.string(), z.number());

const VerticalOfferAdjustmentSchema = z.object({
  multiplier: z.number().positive().optional(),
  cap: z.number().nonnegative().optional(),
});

const DedupeSchema = z.object({
  possible_duplicate_penalty: z.number(),
  duplicate_secondary_penalty: z.number(),
  block_duplicate_secondary_exceptional: z.boolean(),
}).default({
  possible_duplicate_penalty: 0,
  duplicate_secondary_penalty: 0,
  block_duplicate_secondary_exceptional: false,
});

const ScenarioSchema = z.object({
  family: z.enum(["multiplicative_attenuated", "additive_pure", "hybrid_bounded"]),
  gap_depth_cap: z.number().nonnegative(),
  source_quality_bonus: SourceQualityBonusSchema,
  commercial_breadth: z.object({
    secondary_threshold: z.number().nonnegative(),
    secondary_bonus: z.number().nonnegative(),
    tertiary_threshold: z.number().nonnegative(),
    tertiary_bonus: z.number().nonnegative(),
  }),
  business_quality: z.object({
    rating_tiers: z.array(RangePointsRuleSchema).min(1),
    review_tiers: z.array(RangePointsRuleSchema).min(1),
    data_confidence_multiplier: z.number(),
    contact_reliability_multiplier: z.number(),
    corroboration_bonus: z.number(),
    cap: z.number().nonnegative(),
  }),
  accessibility: z.object({
    bounded_bonus_by_tier: z.record(ContactTierSchema, z.number()),
    score_tiers: z.array(z.object({ min: z.number().nonnegative(), points: z.number() })),
    multiplicative_multiplier_by_tier: z.record(ContactTierSchema, z.number().positive()),
    score_multiplier_weight: z.number().nonnegative(),
    reliability_multiplier_weight: z.number().nonnegative(),
  }),
  timing: z.object({
    high_urgency_bonus: z.number(),
    medium_urgency_bonus: z.number(),
    low_urgency_bonus: z.number(),
    franchise_penalty: z.number(),
    freshness_bonus: z.number(),
    stale_penalty: z.number(),
  }),
  offer_adjustments: z.record(z.string(), VerticalOfferAdjustmentSchema).optional(),
  catalogo_by_niche: z.record(z.string(), VerticalOfferAdjustmentSchema).optional(),
  preview_thresholds: z.object({
    normal_max: z.number().int().min(0).max(99),
    good_min: z.number().int().min(0).max(99),
    very_good_min: z.number().int().min(0).max(99),
    exceptional_min: z.number().int().min(0).max(99),
  }).optional(),
  dedupe: DedupeSchema.optional(),
});

const CalibrationConfigSchema = z.object({
  version: z.number().int().positive(),
  default_scenario: z.string().min(1),
  scenarios: z.record(z.string(), ScenarioSchema),
}).superRefine((cfg, ctx) => {
  if (!(cfg.default_scenario in cfg.scenarios)) {
    ctx.addIssue({ code: "custom", path: ["default_scenario"], message: `Unknown scenario: ${cfg.default_scenario}` });
  }
});

let cached: ScoreCalibrationConfig | null = null;

export function parseCalibrationConfig(yamlString: string): ScoreCalibrationConfig {
  const raw = load(yamlString);
  const result = CalibrationConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid scoring calibration config:\n${msgs}`);
  }
  return result.data as ScoreCalibrationConfig;
}

export function getScoringCalibrationConfig(): ScoreCalibrationConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/scoring-calibration.yaml", import.meta.url);
  cached = parseCalibrationConfig(readFileSync(yamlUrl, "utf-8"));
  return cached;
}

export function resetScoringCalibrationConfigCache(): void {
  cached = null;
}
