import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  GOOGLE_PLACES_API_KEY: z
    .string()
    .min(1, "GOOGLE_PLACES_API_KEY is required"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  HEURISTIC_REFRESH_DAYS: z.coerce.number().int().positive().default(30),
  DIRECTORY_REFRESH_DAYS: z.coerce.number().int().positive().default(30),
  SOCIAL_SEARCH_REFRESH_DAYS: z.coerce.number().int().positive().default(30),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${messages}`);
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
