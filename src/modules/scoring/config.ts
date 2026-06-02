import { readFileSync } from "fs";
import { load } from "js-yaml";
import { z } from "zod";
import type { ScoringConfig } from "./types.js";

const FieldConditionSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gte", "lte", "between"]),
  value: z.union([
    z.tuple([z.number(), z.number()]),
    z.number(),
    z.string(),
    z.boolean(),
  ]),
});

const TagConditionSchema = z.object({
  tag: z.string(),
});

const RuleSchema = z.object({
  name: z.string(),
  condition: z.union([TagConditionSchema, FieldConditionSchema]),
  weight: z.number(),
});

const DimensionSchema = z
  .object({ rules: z.array(RuleSchema) })
  .superRefine((dim, ctx) => {
    const seen = new Set<string>();
    for (const rule of dim.rules) {
      if (seen.has(rule.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate rule name: "${rule.name}"`,
        });
        return;
      }
      seen.add(rule.name);
    }
  });

const RangePointsRuleSchema = z.object({
  min: z.number(),
  max: z.number().nullable(),
  points: z.number(),
});

const BuyerTypeConfigSchema = z.object({
  formula: z.record(z.string(), z.number()),
  inferred_required: z.record(z.string(), z.boolean()).optional(),
  niche_required: z.array(z.string()).optional(),
  tag_required: z.string().optional(),
  inferred_bonuses: z.record(z.string(), z.number()).optional(),
  inferred_penalties: z.record(z.string(), z.number()).optional(),
});

const ContactTierSchema = z.enum(["A", "B", "C", "D", "X"]);

const CommercialScoreSchema = z.object({
  gap_depth_cap: z.number().positive(),
  source_quality_bonus: z.record(z.string(), z.number()),
  commercial_breadth: z.object({
    secondary_threshold: z.number().nonnegative(),
    secondary_bonus: z.number().nonnegative(),
    tertiary_threshold: z.number().nonnegative(),
    tertiary_bonus: z.number().nonnegative(),
  }),
  business_quality: z.object({
    rating_tiers: z.array(RangePointsRuleSchema).min(1),
    review_tiers: z.array(RangePointsRuleSchema).min(1),
    data_confidence_multiplier: z.number().nonnegative(),
    contact_reliability_multiplier: z.number().nonnegative(),
    corroboration_bonus: z.number().nonnegative(),
    cap: z.number().positive(),
  }),
  accessibility: z.object({
    tier_base: z.record(ContactTierSchema, z.number().positive()),
    reliability_adjustment: z.object({
      base: z.number().nonnegative(),
      weight: z.number().nonnegative(),
    }),
    score_adjustment: z.object({
      base: z.number().nonnegative(),
      weight: z.number().nonnegative(),
    }),
    contact_score: z.object({
      weights: z.object({
        email: z.number().nonnegative(),
        extra_email: z.number().nonnegative(),
        whatsapp_direct: z.number().nonnegative(),
        whatsapp_derived: z.number().nonnegative(),
        phone: z.number().nonnegative(),
        phone_confirmed_bonus: z.number().nonnegative(),
        address: z.number().nonnegative(),
        website: z.number().nonnegative(),
        contact_form: z.number().nonnegative(),
        social_dm_channel: z.number().nonnegative(),
        whatsapp_web_link: z.number().nonnegative(),
        multi_channel_bonus: z.number().nonnegative(),
        high_confidence_bonus: z.number().nonnegative(),
      }),
      thresholds: z.object({
        A: z.number().nonnegative(),
        B: z.number().nonnegative(),
        C: z.number().nonnegative(),
        D: z.number().nonnegative(),
      }),
      cap: z.number().positive(),
    }),
  }),
  timing: z.object({
    urgency_high: z.number(),
    new_business_window: z.number(),
    competitive_pressure_isolated: z.number(),
    franchise_penalty: z.number(),
    cap: z.number().positive(),
    floor: z.number().positive(),
    days_in_pool: z.object({
      fresh_threshold_days: z.number().positive(),
      fresh_bonus: z.number(),
      stale_threshold_days: z.number().positive(),
      stale_penalty: z.number(),
    }).optional(),
  }),
  urgency_bonus: z.object({
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
});

const PitchHookOverrideWhenSchema = z.object({
  has_delivery: z.boolean().optional(),
  has_pos: z.boolean().optional(),
  has_reservations: z.boolean().optional(),
  has_ecommerce: z.boolean().optional(),
  niche: z.string().optional(),
});

const PitchHookSchema = z.object({
  default: z.string().min(1),
  overrides: z.array(z.object({
    when: PitchHookOverrideWhenSchema,
    text: z.string().min(1),
  })).optional(),
});

const ScoringConfigSchema = z
  .object({
    version: z.number(),
    recent_reviews_threshold_days: z.number().int().positive(),
    business_quality: DimensionSchema,
    digital_gap: DimensionSchema,
    mutual_exclusions: z.object({
      business_quality: z.array(z.array(z.string())).default([]),
      digital_gap: z.array(z.array(z.string())).default([]),
    }),
    cap: z.number().default(100),
    prospect_formula: z.string(),
    commercial_score: CommercialScoreSchema,
    thresholds: z.object({
      hot: z.number().nonnegative(),
      pitcheable: z.number().nonnegative(),
      pool: z.number().nonnegative(),
    }),
    pitch_hooks: z.object({
      web_nuevo: PitchHookSchema,
      rediseno: PitchHookSchema,
      marketing: PitchHookSchema,
      software: PitchHookSchema,
      catalogo: PitchHookSchema,
      contacto_directo: PitchHookSchema,
    }),
    buyer_types: z.record(z.string(), BuyerTypeConfigSchema).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.cap <= 0) {
      ctx.addIssue({ code: "custom", path: ["cap"], message: "cap must be > 0" });
    }
    const bqNames = new Set(cfg.business_quality.rules.map((r) => r.name));
    const dgNames = new Set(cfg.digital_gap.rules.map((r) => r.name));
    for (const group of cfg.mutual_exclusions.business_quality) {
      for (const name of group) {
        if (!bqNames.has(name)) {
          ctx.addIssue({
            code: "custom",
            path: ["mutual_exclusions", "business_quality"],
            message: `Unknown rule: "${name}"`,
          });
        }
      }
    }
    for (const group of cfg.mutual_exclusions.digital_gap) {
      for (const name of group) {
        if (!dgNames.has(name)) {
          ctx.addIssue({
            code: "custom",
            path: ["mutual_exclusions", "digital_gap"],
            message: `Unknown rule: "${name}"`,
          });
        }
      }
    }
  });

let cached: ScoringConfig | null = null;

export function parseConfig(yamlString: string): ScoringConfig {
  const raw = load(yamlString);
  const result = ScoringConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid scoring config:\n${msgs}`);
  }
  return result.data as ScoringConfig;
}

export function getScoringConfig(): ScoringConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/scoring.yaml", import.meta.url);
  const yamlString = readFileSync(yamlUrl, "utf-8");
  cached = parseConfig(yamlString);
  return cached;
}

export function resetScoringConfigCache(): void {
  cached = null;
}
