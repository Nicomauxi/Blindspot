import { Command } from "commander";
import pLimit from "p-limit";
import { z } from "zod";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { computeConcurrency, type RamMode } from "../../shared/ram.js";
import {
  getDiscoveryConfig,
  getSourceRefreshDays,
} from "../../modules/discovery/config.js";
import { enrichCommand } from "./enrich.js";
import { scoreCommand } from "./score.js";

const MaintenanceArgsSchema = z
  .object({
    staleDays: z.coerce.number().int().positive().optional(),
    niche: z.string().min(1).optional(),
    dryRun: z.boolean().default(false),
    ramMode: z.enum(["conservative", "auto", "manual"]).default("conservative"),
    concurrency: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.ramMode !== "manual" && value.concurrency !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--concurrency can only be used with --ram-mode manual",
        path: ["concurrency"],
      });
    }
  });

type MaintenanceArgs = z.infer<typeof MaintenanceArgsSchema>;

interface StaleRun {
  runId: string;
  niche: string;
}

async function queryStaleRuns(
  staleDays: number,
  niche?: string
): Promise<StaleRun[]> {
  const cutoff = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1000
  ).toISOString();

  let query = getSupabase()
    .from("leads")
    .select("first_seen_run_id, niche")
    .eq("passed_filter", true)
    .not("first_seen_run_id", "is", null)
    .or(`digital_footprint.is.null,updated_at.lt.${cutoff}`);

  if (niche) {
    query = query.eq("niche", niche);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query stale leads: ${error.message}`);
  }

  const seen = new Set<string>();
  const runs: StaleRun[] = [];
  for (const row of (data ?? []) as Array<{
    first_seen_run_id: string;
    niche: string;
  }>) {
    if (row.first_seen_run_id && !seen.has(row.first_seen_run_id)) {
      seen.add(row.first_seen_run_id);
      runs.push({ runId: row.first_seen_run_id, niche: row.niche });
    }
  }

  return runs;
}

async function hasStaleLeadsForSource(
  source: string,
  staleDays: number
): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await getSupabase()
    .from("leads")
    .select("id")
    .eq("source", source)
    .eq("passed_filter", true)
    .or(`digital_footprint.is.null,updated_at.lt.${cutoff}`)
    .limit(1);
  if (error)
    throw new Error(`Failed to check stale ${source} leads: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function maintenanceCommandAction(
  rawArgs: Partial<MaintenanceArgs>
): Promise<void> {
  const args = MaintenanceArgsSchema.parse({
    dryRun: false,
    ramMode: "conservative",
    ...rawArgs,
  });

  const log = getLogger();
  const refreshDays = (source: string) =>
    args.staleDays ?? getSourceRefreshDays(source);

  const staleRuns = await queryStaleRuns(refreshDays("google_places"), args.niche);

  const config = getDiscoveryConfig();
  const externalSources = Object.keys(config.source_refresh ?? {}).filter(
    (s) => s !== "google_places"
  );
  const staleExternalSources: string[] = [];
  for (const source of externalSources) {
    if (await hasStaleLeadsForSource(source, refreshDays(source))) {
      staleExternalSources.push(source);
    }
  }

  if (args.dryRun) {
    console.log(
      `Found ${staleRuns.length} run(s) with stale/missing enrichment (Google Places)`
    );
    for (const { runId, niche } of staleRuns) {
      console.log(`  ${runId} (${niche})`);
    }
    if (staleExternalSources.length > 0) {
      console.log(
        `External sources with stale leads: ${staleExternalSources.join(", ")}`
      );
    }
    return;
  }

  if (staleRuns.length === 0 && staleExternalSources.length === 0) {
    console.log("No stale leads found. Nothing to do.");
    return;
  }

  const ram = computeConcurrency(args.ramMode as RamMode, args.concurrency);

  log.info(
    {
      runs: staleRuns.length,
      externalSources: staleExternalSources,
      concurrency: ram.concurrency,
      mode: ram.mode,
    },
    "Starting maintenance"
  );

  const limit = pLimit(ram.concurrency);
  await Promise.all(
    staleRuns.map(({ runId }) =>
      limit(() =>
        enrichCommand({
          run: runId,
          withHeuristic: true,
          forceRefresh: false,
          concurrency: "5",
          all: false,
        })
      )
    )
  );

  for (const source of staleExternalSources) {
    log.info({ source }, "Enriching stale external source leads");
    await enrichCommand({
      source,
      withHeuristic: false,
      forceRefresh: false,
      concurrency: "5",
      all: false,
    });
  }

  await scoreCommand({ all: true, dryRun: false });

  console.log(`Maintenance complete`);
  console.log(`Runs processed: ${staleRuns.length}`);
  if (staleExternalSources.length > 0) {
    console.log(`External sources enriched: ${staleExternalSources.join(", ")}`);
  }
  console.log(`RAM mode: ${ram.mode} | concurrency: ${ram.concurrency}`);
  console.log(`Score --all completed`);
}

export const maintenanceCommand = new Command("maintenance")
  .description("Re-enrich stale or unprocessed leads and re-score all")
  .option(
    "--stale-days <N>",
    "Days before a lead is considered stale (default: per-source config)"
  )
  .option("--niche <text>", "Limit maintenance to a specific niche")
  .option("--dry-run", "Show counts only, do not enrich")
  .option(
    "--ram-mode <conservative|auto|manual>",
    "RAM-aware concurrency mode",
    "conservative"
  )
  .option(
    "--concurrency <N>",
    "Manual concurrency override (requires --ram-mode manual)"
  )
  .action(async (options) => {
    try {
      await maintenanceCommandAction(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });
