import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { z } from "zod";

export interface SystemsGapRule {
  name: string;
  weight: number;
  platforms?: string[] | undefined;
  keywords?: string[] | undefined;
  html_patterns?: string[] | undefined;
  applies_to?: string[] | undefined;
  requires?: string[] | undefined;
  requires_none_of?: string[] | undefined;
}

export interface SystemsGapConfig {
  version: number;
  enabled: boolean;
  rules: Record<string, SystemsGapRule[]>;
}

const SystemsGapRuleSchema = z.object({
  name: z.string().min(1),
  weight: z.number().positive(),
  platforms: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  html_patterns: z.array(z.string()).optional(),
  applies_to: z.array(z.string()).optional(),
  requires: z.array(z.string()).optional(),
  requires_none_of: z.array(z.string()).optional(),
});

const SystemsGapConfigSchema = z
  .object({
    version: z.number(),
    enabled: z.boolean().default(true),
    rules: z.record(z.string(), z.array(SystemsGapRuleSchema)),
  })
  .superRefine((config, ctx) => {
    for (const [niche, rules] of Object.entries(config.rules)) {
      const seen = new Set<string>();
      for (const rule of rules) {
        if (seen.has(rule.name)) {
          ctx.addIssue({
            code: "custom",
            path: ["rules", niche],
            message: `Duplicate systems_gap rule name: "${rule.name}"`,
          });
          return;
        }
        seen.add(rule.name);
      }
    }
  });

let cached: SystemsGapConfig | null = null;

export function parseSystemsGapConfig(yamlString: string): SystemsGapConfig {
  const raw = load(yamlString);
  const result = SystemsGapConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid systems-gap config:\n${msgs}`);
  }
  return result.data;
}

export function getSystemsGapConfig(): SystemsGapConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/systems-gap.yaml", import.meta.url);
  const yamlString = readFileSync(yamlUrl, "utf-8");
  cached = parseSystemsGapConfig(yamlString);
  return cached;
}

export function resetSystemsGapConfigCache(): void {
  cached = null;
}
