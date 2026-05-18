import { readFileSync } from "fs";
import { load } from "js-yaml";
import { z } from "zod";
import type { DiscoveryConfig, ProfileConfig, ScrapingConfig } from "../../shared/types.js";

const ProfileConfigSchema: z.ZodType<ProfileConfig> = z
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

const ScrapingConfigSchema: z.ZodType<ScrapingConfig> = z.object({
  discovery_ua_pool: z.array(z.string()).min(1),
  discovery_delay_ms: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  discovery_max_retries: z.number().int().min(0),
  social_ua_pool: z.array(z.string()).min(1),
  social_delay_ms: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  social_max_retries: z.number().int().min(0),
  proxy_enabled: z.boolean(),
});

const DiscoveryConfigSchema: z.ZodType<DiscoveryConfig> = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), ProfileConfigSchema),
  social_domains: z.array(z.string()),
  persist_rejected: z.boolean(),
  source_refresh: z.record(z.string(), z.number().int().positive()).optional(),
  deduplication: z.object({
    geo_radius_meters: z.number().int().positive().optional(),
    name_threshold_online: z.number().min(0).max(1).optional(),
    name_threshold_retroactive: z.number().min(0).max(1).optional(),
  }).optional(),
  scraping: ScrapingConfigSchema.optional(),
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
  return result.data;
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

export function getSourceRefreshDays(source: string, fallback = 30): number {
  return getDiscoveryConfig().source_refresh?.[source] ?? fallback;
}

export function getDedupGeoRadiusMeters(fallback = 500): number {
  return getDiscoveryConfig().deduplication?.geo_radius_meters ?? fallback;
}

export function getOnlineDedupThreshold(fallback = 0.85): number {
  return getDiscoveryConfig().deduplication?.name_threshold_online ?? fallback;
}

export function getRetroactiveDedupThreshold(fallback = 0.9): number {
  return getDiscoveryConfig().deduplication?.name_threshold_retroactive ?? fallback;
}

const DEFAULT_SCRAPING: ScrapingConfig = {
  discovery_ua_pool: [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ],
  discovery_delay_ms: [800, 2500],
  discovery_max_retries: 3,
  social_ua_pool: [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ],
  social_delay_ms: [1500, 4000],
  social_max_retries: 2,
  proxy_enabled: false,
};

export function getScrapingConfig(): ScrapingConfig {
  return getDiscoveryConfig().scraping ?? DEFAULT_SCRAPING;
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
