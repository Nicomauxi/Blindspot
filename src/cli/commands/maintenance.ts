import { Command } from "commander";
import pLimit from "p-limit";
import { z } from "zod";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { computeConcurrency, type RamMode } from "../../shared/ram.js";
import { enrichCommand } from "./enrich.js";
import { scoreCommand } from "./score.js";

const MaintenanceArgsSchema = z
  .object({
    staleDays: z.coerce.number().int().positive().default(7),
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

export async function maintenanceCommandAction(
  rawArgs: Partial<MaintenanceArgs>
): Promise<void> {
  const args = MaintenanceArgsSchema.parse({
    staleDays: 7,
    dryRun: false,
    ramMode: "conservative",
    ...rawArgs,
  });

  const log = getLogger();
  const staleRuns = await queryStaleRuns(args.staleDays, args.niche);

  if (args.dryRun) {
    console.log(
      `Found ${staleRuns.length} run(s) with stale/missing enrichment`
    );
    for (const { runId, niche } of staleRuns) {
      console.log(`  ${runId} (${niche})`);
    }
    return;
  }

  if (staleRuns.length === 0) {
    console.log("No stale runs found. Nothing to do.");
    return;
  }

  const ram = computeConcurrency(args.ramMode as RamMode, args.concurrency);

  log.info(
    { runs: staleRuns.length, concurrency: ram.concurrency, mode: ram.mode },
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

  await scoreCommand({ all: true, dryRun: false });

  console.log(`Maintenance complete`);
  console.log(`Runs processed: ${staleRuns.length}`);
  console.log(`RAM mode: ${ram.mode} | concurrency: ${ram.concurrency}`);
  console.log(`Score --all completed`);
}

export const maintenanceCommand = new Command("maintenance")
  .description("Re-enrich stale or unprocessed leads and re-score all")
  .option("--stale-days <N>", "Days before a lead is considered stale", "7")
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
