import { Command } from "commander";
import { discoverCommand, collectOverride } from "./commands/discover.js";
import { enrichCommand } from "./commands/enrich.js";
import { heuristicRefreshCommand } from "./commands/heuristic-refresh.js";
import { scoreCommand } from "./commands/score.js";
import { reportCommand } from "./commands/report.js";
import { leadsListCommand } from "./commands/leads-list.js";
import { vocabularyCommand } from "./commands/vocabulary.js";
import { socialEnrichCommand } from "./commands/social-enrich.js";

const program = new Command();

program
  .name("blindspot")
  .description(
    "Identify local businesses with strong offline reputation but poor digital presence"
  )
  .version("1.0.0");

program
  .command("discover")
  .description(
    "Search Google Places for leads matching a niche+location, filter by profile, persist results"
  )
  .requiredOption("--niche <string>", "Business niche to search for (e.g. 'peluquería')")
  .requiredOption("--location <string>", "Location to search in (e.g. 'Montevideo Uruguay')")
  .requiredOption(
    "--profile <a|b>",
    "Filter profile: a=hidden gem (high rating, few reviews, no/social web), b=saturated no-web (many reviews, no website)"
  )
  .option("--max-results <number>", "Max places to retrieve from Places API", "50")
  .option("--override <key=value>", "Override a profile threshold (repeatable)", collectOverride, [])
  .option("--trace", "Enable debug logging and write run-trace.json artifact to reports/<run_id>/", false)
  .action(async (opts: {
    niche: string;
    location: string;
    profile: string;
    maxResults: string;
    override: string[];
    trace: boolean;
  }) => {
    await discoverCommand({
      niche: opts.niche,
      location: opts.location,
      profile: opts.profile,
      maxResults: opts.maxResults,
      override: opts.override,
      trace: opts.trace,
    });
  });

program
  .command("enrich")
  .description(
    "Enrich leads of a discovery run with digital footprint signals (HTML + WHOIS)"
  )
  .requiredOption("--run <uuid>", "Discovery run id whose leads should be enriched")
  .option("--force-refresh", "Ignore cache and re-fetch HTML / WHOIS for every lead", false)
  .option("--with-heuristic", "Discover candidate websites/social/WhatsApp before enrichment", false)
  .option("--concurrency <number>", "Max parallel HTTP fetches", "5")
  .action(async (opts: {
    run: string;
    forceRefresh: boolean;
    withHeuristic: boolean;
    concurrency: string;
  }) => {
    await enrichCommand({
      run: opts.run,
      forceRefresh: opts.forceRefresh,
      withHeuristic: opts.withHeuristic,
      concurrency: opts.concurrency,
    });
  });

program
  .command("heuristic-refresh")
  .description("Refresh heuristic discovery for passed leads without a confirmed real website")
  .option("--run <uuid>", "Discovery run id whose leads should be refreshed")
  .option("--all", "Refresh all passed leads without a confirmed real website", false)
  .option("--force", "Refresh even when heuristic discovery is still fresh", false)
  .option("--concurrency <number>", "Max parallel HTTP fetches", "5")
  .action(async (opts: {
    run?: string;
    all?: boolean;
    force?: boolean;
    concurrency: string;
  }) => {
    await heuristicRefreshCommand({
      ...(opts.run ? { run: opts.run } : {}),
      all: opts.all ?? false,
      force: opts.force ?? false,
      concurrency: opts.concurrency,
    });
  });

program
  .command("social-enrich")
  .description("Enrich heuristic social profiles through headless browser extraction")
  .option("--run <uuid>", "Discovery run id whose leads should be social-enriched")
  .option("--all", "Social-enrich all passed leads with heuristic social tags", false)
  .option("--limit <number>", "Max leads to process", "10")
  .option("--force", "Re-process even when Playwright social search is fresh", false)
  .action(async (opts: {
    run?: string;
    all?: boolean;
    limit: string;
    force?: boolean;
  }) => {
    await socialEnrichCommand({
      ...(opts.run ? { run: opts.run } : {}),
      all: opts.all ?? false,
      limit: opts.limit,
      force: opts.force ?? false,
    });
  });

program
  .command("score")
  .description("Score leads by computing business_quality, digital_gap, and prospect scores")
  .option("--run <uuid>", "Score leads of this discovery/enrichment run")
  .option("--all", "Score all leads in the DB (mutually exclusive with --run)")
  .option("--dry-run", "Compute scores without persisting to the DB", false)
  .action(async (opts: { run?: string; all?: boolean; dryRun?: boolean }) => {
    await scoreCommand({
      ...(opts.run ? { run: opts.run } : {}),
      all: opts.all ?? false,
      dryRun: opts.dryRun ?? false,
    });
  });

program
  .command("report")
  .description("Generate CSV, HTML, and/or Markdown reports for a run (read-only, no DB writes)")
  .requiredOption("--run <uuid>", "Run id whose leads to report")
  .option("--format <csv|html|md|all>", "Report format(s) to generate", "all")
  .option("--output-dir <path>", "Output directory (default: ./reports/<run_id>/)")
  .option("--min-prospect <number>", "Exclude leads with prospect_score below this threshold", "0")
  .action(
    async (opts: {
      run: string;
      format: string;
      outputDir: string | undefined;
      minProspect: string;
    }) => {
      await reportCommand({
        run: opts.run,
        format: opts.format,
        ...(opts.outputDir !== undefined ? { outputDir: opts.outputDir } : {}),
        minProspect: opts.minProspect,
      });
    }
  );

const leadsCmd = program
  .command("leads")
  .description("Lead inspection and management commands");

leadsCmd
  .command("list")
  .description("List leads for a run, or all leads if --run is omitted")
  .option("--run <uuid>", "Filter by run id (optional)")
  .option("--rejected-only", "Show only rejected leads", false)
  .option("--passed-only", "Show only passed leads", false)
  .option("--limit <number>", "Max results", "100")
  .option("--format <table|json>", "Output format", "table")
  .action(async (opts: {
    run?: string;
    rejectedOnly?: boolean;
    passedOnly?: boolean;
    limit: string;
    format: string;
  }) => {
    await leadsListCommand(opts);
  });

const vocabCmd = program
  .command("vocabulary")
  .description("Manage the dynamic niche stop-word vocabulary learned from leads");

vocabCmd
  .command("rebuild")
  .description("Rebuild the niche vocabulary from current leads")
  .option("--all", "Rebuild for every niche that has leads", false)
  .option("--niche <name>", "Rebuild for a specific niche only")
  .option("--min-count <number>", "Minimum lead count for a word to qualify", "3")
  .option("--min-fraction <number>", "Minimum fraction of niche leads for a word to qualify", "0.05")
  .action(async (opts: { all?: boolean; niche?: string; minCount: string; minFraction: string }) => {
    await vocabularyCommand({
      subcommand: "rebuild",
      all: opts.all ?? false,
      ...(opts.niche !== undefined ? { niche: opts.niche } : {}),
      minCount: Number(opts.minCount),
      minFraction: Number(opts.minFraction),
    });
  });

vocabCmd
  .command("show")
  .description("Display the vocabulary for a niche")
  .requiredOption("--niche <name>", "Niche to display")
  .action(async (opts: { niche: string }) => {
    await vocabularyCommand({ subcommand: "show", niche: opts.niche });
  });

program.parse(process.argv);
