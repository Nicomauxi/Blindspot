import { Command } from "commander";
import { getLogger } from "../../shared/logger.js";
import { transitionToPending, executeRun } from "../../modules/pipeline/run-executor.js";
import { getSupabase } from "../../shared/supabase.js";
import { backfillGooglePlacesBudget, getGooglePlacesBudgetStatus } from "../../storage/pipeline-config.js";
import type { PipelineRun, CpuBudget } from "../../modules/pipeline/types.js";

const logger = getLogger();

export const pipelineCommand = new Command("pipeline")
  .description("Run the full pipeline or manage pipeline configuration")
  .option("--run-all", "Execute all pipeline phases in sequence")
  .option("--dry-run", "Simulate execution without modifying data")
  .option(
    "--cpu-budget <budget>",
    "CPU budget: conservative | balanced | aggressive",
    "balanced"
  )
  .option(
    "--phases <phases>",
    "Comma-separated phases to run (refresh,discovery,enrich,score)",
    "refresh,discovery,enrich,score"
  )
  .action(async (opts: {
    runAll?: boolean;
    dryRun?: boolean;
    cpuBudget: string;
    phases: string;
  }) => {
    if (!opts.runAll) {
      pipelineCommand.help();
      return;
    }

    const phases = opts.phases.split(",").map((p) => p.trim()).filter(Boolean);
    const cpuBudget = (["conservative", "balanced", "aggressive"].includes(opts.cpuBudget)
      ? opts.cpuBudget
      : "balanced") as CpuBudget;

    logger.info({ dryRun: opts.dryRun ?? false, cpuBudget, phases }, "Starting pipeline run");

    const runId = await transitionToPending("manual", {
      dry_run: opts.dryRun ?? false,
      phases,
      cpu_budget: cpuBudget,
    });

    const supabase = getSupabase();
    const { data: runData, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (error || !runData) {
      logger.error({ error }, "Failed to fetch run after insert");
      process.exit(1);
    }

    const result = await executeRun(runData as PipelineRun);

    if (result.status === "completed") {
      logger.info({ runId, status: result.status }, "Pipeline run completed successfully");
      process.exit(0);
    } else {
      logger.warn({ runId, status: result.status }, "Pipeline run finished with partial/failed status");
      process.exit(1);
    }
  });

pipelineCommand
  .command("budget")
  .description("Show Google Places budget status or backfill historical spend")
  .option("--backfill", "Recompute google_places_budget_spent from all completed runs", false)
  .action(async (opts: { backfill: boolean }) => {
    if (opts.backfill) {
      logger.info("Backfilling Google Places budget from historical runs…");
      const result = await backfillGooglePlacesBudget();
      logger.info({ total_runs: result.total_runs, total_cost_usd: result.total_cost_usd }, "Budget backfill complete");
      return;
    }
    const status = await getGooglePlacesBudgetStatus();
    if (!status) {
      console.log("No pipeline_config found");
      return;
    }
    console.log(`Google Places Budget:`);
    console.log(`  Total:      $${status.budget_total.toFixed(2)}`);
    console.log(`  Spent:      $${status.budget_spent.toFixed(2)}`);
    console.log(`  Remaining:  $${status.budget_remaining.toFixed(2)}`);
    console.log(`  Alert at:   $${status.alert_threshold.toFixed(2)}`);
    if (status.over_alert) {
      console.log(`  ⚠ Budget remaining is below alert threshold!`);
    }
  });
