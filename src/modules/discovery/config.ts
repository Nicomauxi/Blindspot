import { readFileSync } from "fs";
import { load } from "js-yaml";
import { z } from "zod";
import type { DiscoveryConfig, ProfileConfig } from "../../shared/types.js";

const ProfileConfigSchema = z
  .object({
    description: z.string().optional(),
    min_rating: z.number().min(0).max(5),
    min_reviews: z.number().int().min(0),
    max_reviews: z.number().int().min(0).nullable(),
    web_requirement: z.enum(["social_or_missing", "missing_only", "any"]),
  })
  .superRefine((data, ctx) => {
    if (data.max_reviews !== null && data.min_reviews > data.max_reviews) {
      ctx.addIssue({
        code: "custom",
        message: `min_reviews (${data.min_reviews}) cannot exceed max_reviews (${data.max_reviews})`,
        path: ["min_reviews"],
      });
    }
  });

const DiscoveryConfigSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), ProfileConfigSchema),
  social_domains: z.array(z.string()),
  persist_rejected: z.boolean(),
});

let cached: DiscoveryConfig | null = null;

export function parseDiscoveryConfig(yamlString: string): DiscoveryConfig {
  const raw = load(yamlString);
  const result = DiscoveryConfigSchema.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid discovery config:\n${msgs}`);
  }
  return result.data as unknown as DiscoveryConfig;
}

export function getDiscoveryConfig(): DiscoveryConfig {
  if (cached !== null) return cached;
  const yamlUrl = new URL("../../../config/discovery.yaml", import.meta.url);
  const yamlString = readFileSync(yamlUrl, "utf-8");
  cached = parseDiscoveryConfig(yamlString);
  return cached;
}

export function resetDiscoveryConfigCache(): void {
  cached = null;
}

export function getProfileConfig(
  name: string,
  overrides?: Partial<ProfileConfig>
): ProfileConfig {
  const config = getDiscoveryConfig();
  const profile = config.profiles[name];
  if (!profile) {
    const available = Object.keys(config.profiles).join(", ");
    throw new Error(
      `Unknown discovery profile: "${name}". Available profiles: ${available}`
    );
  }
  if (!overrides || Object.keys(overrides).length === 0) return profile;

  const merged = { ...profile, ...overrides };
  const result = ProfileConfigSchema.safeParse(merged);
  if (!result.success) {
    const msgs = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid profile config after overrides:\n${msgs}`);
  }
  return result.data as ProfileConfig;
}
