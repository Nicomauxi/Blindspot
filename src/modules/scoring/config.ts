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

const SUB_SCORE_KEYS = ["web_nuevo", "rediseno", "marketing", "software", "catalogo"] as const;

const BuyerTypeConfigSchema = z.object({
  formula: z.record(z.string(), z.number()),
  inferred_required: z.record(z.string(), z.boolean()).optional(),
  niche_required: z.array(z.string()).optional(),
  tag_required: z.string().optional(),
  inferred_bonuses: z.record(z.string(), z.number()).optional(),
  inferred_penalties: z.record(z.string(), z.number()).optional(),
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
