import { Command } from "commander";
import { getScoringConfig } from "../modules/scoring/config.js";
import { getDiscoveryConfig } from "../modules/discovery/config.js";
import { discoverCommand, collectOverride } from "./commands/discover.js";
import { enrichCommand } from "./commands/enrich.js";
import { heuristicRefreshCommand } from "./commands/heuristic-refresh.js";
import { scoreCommand } from "./commands/score.js";
import { scoreEvalCommand } from "./commands/score-eval.js";
import { scoreSimulateCommand } from "./commands/score-simulate.js";
import { scoreRolloutV3Command } from "./commands/score-rollout-v3.js";
import { reportCommand } from "./commands/report.js";
import { leadsListCommand } from "./commands/leads-list.js";
import { vocabularyCommand } from "./commands/vocabulary.js";
import { socialEnrichCommand } from "./commands/social-enrich.js";
import { runCommand } from "./commands/run.js";
import { maintenanceCommand } from "./commands/maintenance.js";
import { discoverExternalCommand } from "./commands/discover-external.js";
import { inferStateCommand } from "./commands/infer-state.js";
import { reconcileRetroactiveCommand } from "./commands/reconcile-retroactive.js";
import { pipelineCommand } from "./commands/pipeline.js";
import { outreachCommand } from "./commands/outreach.js";
import { enrichSubNicheCommand } from "./commands/enrich-sub-niche.js";
import { enrichTipoOperadorCommand } from "./commands/enrich-tipo-operador.js";

const program = new Command();

program
  .name("blindspot")
  .description(
    "Identify local businesses with strong offline reputation but poor digital presence"
  )
  .version("1.0.0");

program
  .command("discover-google-places")
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
    "Enrich leads with digital footprint signals (HTML + WHOIS)"
  )
  .option("--run <uuid>", "Discovery run id whose leads should be enriched")
  .option("--source <source>", "Enrich all passed leads from a specific source (e.g. mintur, osm)")
  .option("--force-refresh", "Ignore cache and re-fetch HTML / WHOIS for every lead", false)
  .option("--with-heuristic", "Discover candidate websites/social/WhatsApp before enrichment", false)
  .option("--concurrency <number>", "Max parallel HTTP fetches", "5")
  .option("--all", "Enrich all passed leads in the DB regardless of source (mutually exclusive with --run and --source)", false)
  .action(async (opts: {
    run?: string;
    source?: string;
    forceRefresh: boolean;
    withHeuristic: boolean;
    concurrency: string;
    all: boolean;
  }) => {
    await enrichCommand({
      ...(opts.run ? { run: opts.run } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      all: opts.all,
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
  .command("social-discover")
  .description("F1: descubre IG/FB de leads digital-dark vía SearXNG (gratis). Concurrente + instrumentado.")
  .option("--run <uuid>", "Solo leads de este run")
  .option("--all", "Todos los leads del pool digital-dark", false)
  .option("--limit <number>", "Máx leads a procesar (mejor prospect_score primero)")
  // Default 4: con IG+FB en paralelo por lead, son ~8 requests concurrentes a SearXNG
  // (sweet spot medido; más allá el upstream rate-limita y baja el hit-rate).
  .option("--concurrency <number>", "Workers en paralelo (×2 queries c/u)", "4")
  .option("--throttle-ms <number>", "Delay entre IG y FB por lead (0 = paralelo)", "0")
  .option("--with-metrics", "Pasada integrada: tras descubrir el perfil, extraer followers/liveness (señal de scoring)", false)
  .option("--serper-fallback", "Serper: 2da query dirigida si q1 no trae métricas (más créditos)", false)
  .action(async (opts: { run?: string; all?: boolean; limit?: string; concurrency?: string; throttleMs?: string; withMetrics?: boolean; serperFallback?: boolean }) => {
    const { runSocialDiscovery } = await import("./../modules/social-enrich/social-discover-run.js");
    const stats = await runSocialDiscovery({
      ...(opts.run ? { run: opts.run } : { all: true }),
      ...(opts.limit ? { limit: Number(opts.limit) } : {}),
      concurrency: Number(opts.concurrency ?? "4"),
      throttleMs: Number(opts.throttleMs ?? "0"),
      withMetrics: opts.withMetrics ?? false,
      serperFallback: opts.serperFallback ?? false,
    });
    console.log(`\nSocial discover: ${stats.found_any} con perfil (${stats.found_instagram} IG / ${stats.found_facebook} FB) / ${stats.no_match} sin match / ${stats.candidates} candidatos`);
    if (opts.withMetrics) {
      console.log(`   métricas: ${stats.found_metrics} con followers/liveness / ${stats.found_url_no_metrics} perfil sin métricas públicas`);
    }
    console.log(`⏱  throughput: ${stats.leads_per_sec} leads/seg · ${(stats.elapsed_ms / 1000).toFixed(1)}s · concurrency=${opts.concurrency ?? "4"}`);
  });

program
  .command("ig-snippet-enrich")
  .description("Enrich IG metrics + liveness via search snippet (free, $0). Default provider: self-hosted SearXNG (SEARXNG_URL).")
  .option("--run <uuid>", "Enrich leads of this run")
  .option("--all", "Enrich all passed leads with a selected Instagram URL", false)
  .option("--limit <number>", "Max leads to process (best prospect_score first)")
  .option("--throttle-ms <number>", "Delay between queries (anti rate-limit, por worker)", "1500")
  .option("--concurrency <number>", "Workers en paralelo (F1: SearXNG aguanta ~8)", "1")
  .option("--retry-no-data", "Re-query leads previously marked no_data", false)
  .action(async (opts: { run?: string; all?: boolean; limit?: string; throttleMs?: string; concurrency?: string; retryNoData?: boolean }) => {
    const { runIgSnippetEnrich } = await import("./../modules/social-enrich/ig-snippet-enrich.js");
    const stats = await runIgSnippetEnrich({
      ...(opts.run ? { run: opts.run } : { all: true }),
      ...(opts.limit ? { limit: Number(opts.limit) } : {}),
      throttleMs: Number(opts.throttleMs ?? "1500"),
      concurrency: Number(opts.concurrency ?? "1"),
      retryNoData: opts.retryNoData ?? false,
    });
    console.log(`\nIG snippet enrich: ${stats.enriched} enriquecidos / ${stats.no_snippet} sin métricas / ${stats.skipped_resolved} ya resueltos / ${stats.skipped_no_url} sin URL${stats.aborted_provider_down ? " — ABORTADO (proveedor caído)" : ""}`);
    console.log(`⏱  throughput: ${stats.leads_per_sec} leads/seg · ${(stats.elapsed_ms / 1000).toFixed(1)}s · concurrency=${opts.concurrency ?? "1"}`);
  });

program
  .command("score")
  .description("Score leads by computing business_quality, digital_gap, and prospect scores")
  .option("--run <uuid>", "Score leads of this discovery/enrichment run")
  .option("--all", "Score all leads in the DB (mutually exclusive with --run)")
  .option("--buyer-types", "Compute buyer-type scores for all leads with score_breakdown", false)
  .option("--buyer-type <type>", "Only compute this buyer type (requires --buyer-types)")
  .option("--dry-run", "Compute scores without persisting to the DB", false)
  .action(async (opts: { run?: string; all?: boolean; buyerTypes?: boolean; buyerType?: string; dryRun?: boolean }) => {
    await scoreCommand({
      ...(opts.run ? { run: opts.run } : {}),
      all: opts.all ?? false,
      buyerTypes: opts.buyerTypes ?? false,
      ...(opts.buyerType ? { buyerType: opts.buyerType } : {}),
      dryRun: opts.dryRun ?? false,
    });
  });

program
  .command("score-eval")
  .description("Simulate scoring v2 against the current v1 snapshot without persisting any DB changes")
  .option("--output-dir <path>", "Output directory (default: ./reports/22-eval/<timestamp>/)")
  .option("--top <number>", "Top-N size for comparison tables", "50")
  .option("--gold-set-size <number>", "Bootstrap gold-set candidate count", "40")
  .action(async (opts: {
    outputDir?: string;
    top: string;
    goldSetSize: string;
  }) => {
    await scoreEvalCommand({
      ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
      top: opts.top,
      goldSetSize: opts.goldSetSize,
    });
  });


program
  .command("score-simulate")
  .description("Simulate scoring calibration scenarios against the current scoring_version=2 cohort without persisting changes")
  .option("--scenario <name>", "Only run one calibration scenario")
  .option("--output-dir <path>", "Output directory (default: ./reports/scoring-calibration/<timestamp>/)")
  .option("--gold-set <path>", "CSV with reviewed gold-set labels")
  .option("--gold-set-size <number>", "Seed size for gold-set candidate export", "80")
  .action(async (opts: { scenario?: string; outputDir?: string; goldSet?: string; goldSetSize: string }) => {
    await scoreSimulateCommand({
      ...(opts.scenario ? { scenario: opts.scenario } : {}),
      ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
      ...(opts.goldSet ? { goldSet: opts.goldSet } : {}),
      goldSetSize: opts.goldSetSize,
    });
  });

program
  .command("score-rollout-v3")
  .description("Persist a calibrated scoring v3 scenario for a selected scoring cohort")
  .requiredOption("--scenario <name>", "Calibration scenario to persist")
  .option("--snapshot-label <label>", "Snapshot label for rollback backup")
  .option("--output-dir <path>", "Output directory (default: ./reports/score-rollout-v3/<snapshot>/)")
  .option("--from-version <number>", "Only rescore leads currently on this scoring_version", "2")
  // N102: dry-run por DEFAULT — antes reescribía los scores de todo el pool sin
  // confirmación. Persistir exige --apply explícito.
  .option("--apply", "Persist DB writes (sin esta flag corre en dry-run)", false)
  .option("--dry-run", "(deprecado: es el default) Simulate the rollout without persisting DB writes", false)
  .action(async (opts: { scenario: string; snapshotLabel?: string; outputDir?: string; fromVersion: string; dryRun?: boolean; apply?: boolean }) => {
    await scoreRolloutV3Command({
      scenario: opts.scenario,
      ...(opts.snapshotLabel ? { snapshotLabel: opts.snapshotLabel } : {}),
      ...(opts.outputDir ? { outputDir: opts.outputDir } : {}),
      fromVersion: Number(opts.fromVersion),
      dryRun: opts.apply !== true,
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
  .option("--run <uuid>", "Filter by first_seen_run_id (leads discovered in this run)")
  .option("--seen-in <uuid>", "Filter by last_seen_run_id (leads last seen in this run)")
  .option("--rejected-only", "Show only rejected leads", false)
  .option("--passed-only", "Show only passed leads", false)
  .option("--limit <number>", "Max results", "100")
  .option("--format <table|json>", "Output format", "table")
  .action(async (opts: {
    run?: string;
    seenIn?: string;
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

program
  .command("discover-mintur")
  .description("Fetch leads from MINTUR dataset and persist to DB")
  .requiredOption("--location <string>", "Location filter (e.g. 'Montevideo', 'Colonia')")
  .option("--niche <string>", "Niche hint (MINTUR ignores este hint y ahora intenta mapear niches canónicos desde TipoOperador/Operador)", "other")
  .option("--limit <number>", "Max candidates to process (useful for smoke tests)")
  .option("--dry-run", "Simulate without writing to DB", false)
  .action(async (opts: {
    location: string;
    niche: string;
    limit?: string;
    dryRun: boolean;
  }) => {
    await discoverExternalCommand({
      source: "mintur",
      location: opts.location,
      niche: opts.niche,
      ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
      dryRun: opts.dryRun,
    });
  });

program
  .command("discover-osm")
  .description("Fetch leads from OpenStreetMap via Overpass API and persist to DB")
  .requiredOption("--location <string>", "Location to search (e.g. 'Montevideo', 'Colonia')")
  .option("--niche <string>", "Niche to search (restaurant|gym|hairdresser|car_dealer|other)", "other")
  .option("--limit <number>", "Max candidates to process (useful for smoke tests)")
  .option("--dry-run", "Simulate without writing to DB", false)
  .action(async (opts: {
    location: string;
    niche: string;
    limit?: string;
    dryRun: boolean;
  }) => {
    await discoverExternalCommand({
      source: "osm",
      location: opts.location,
      niche: opts.niche,
      ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
      dryRun: opts.dryRun,
    });
  });

program
  .command("discover-external")
  .description("Fetch leads from an external source (yelu, pedidosya) and persist to DB")
  .requiredOption("--source <string>", "Source provider: yelu|pedidosya")
  .option("--location <string>", "Location to search (e.g. 'Montevideo')", "Montevideo")
  .option("--niche <string>", "Niche to search (restaurant|gym|hairdresser|car_dealer|other)", "other")
  .option("--location-list <locations...>", "Space-separated list of locations for batch mode")
  .option("--location-list-file <file>", "YAML file with locations list (e.g. config/locations.yaml)")
  .option("--limit <number>", "Max candidates to process per location (useful for smoke tests)")
  .option("--dry-run", "Simulate without writing to DB", false)
  .action(async (opts: {
    source: string;
    location: string;
    niche: string;
    locationList?: string[];
    locationListFile?: string;
    limit?: string;
    dryRun: boolean;
  }) => {
    const discoverOpts: Parameters<typeof discoverExternalCommand>[0] = {
      source: opts.source,
      location: opts.location,
      niche: opts.niche,
      dryRun: opts.dryRun,
    };
    if (opts.locationList) discoverOpts.locationList = opts.locationList;
    if (opts.locationListFile) discoverOpts.locationListFile = opts.locationListFile;
    if (opts.limit !== undefined) discoverOpts.limit = Number(opts.limit);
    await discoverExternalCommand(discoverOpts);
  });

program
  .command("reconcile-retroactive")
  .description("Reconcile retroactive cross-source duplicates over existing local leads")
  .option("--apply", "Apply the reconciliation instead of reporting dry-run candidates", false)
  .option("--limit <number>", "Max groups to apply when --apply is used")
  .action(async (opts: { apply?: boolean; limit?: string }) => {
    await reconcileRetroactiveCommand({
      apply: opts.apply ?? false,
      ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
    });
  });

program.addCommand(runCommand);
program.addCommand(maintenanceCommand);

program
  .command("infer-state")
  .description("Compute inferred operational state for enriched leads")
  .option("--all", "process all leads (required)", false)
  .option("--passed-only", "only process passed_filter=true leads (default: true)", true)
  .option("--force", "recompute even if recently computed", false)
  .option("--concurrency <n>", "parallel workers", "20")
  .action(async (opts: {
    all: boolean;
    passedOnly: boolean;
    force: boolean;
    concurrency: string;
  }) => {
    await inferStateCommand({
      all: opts.all,
      passedOnly: opts.passedOnly,
      force: opts.force,
      concurrency: opts.concurrency,
    });
  });

program.addCommand(pipelineCommand);

program
  .command("enrich-tipo-operador")
  .description("Backfill tipo_operador from MINTUR source_data for MINTUR leads")
  .option("--dry-run", "Report what would be updated without writing to DB", false)
  .action(async (opts: { dryRun: boolean }) => {
    await enrichTipoOperadorCommand({ dryRun: opts.dryRun });
  });

program
  .command("enrich-sub-niche")
  .description("Detect sub-niches for leads with niche=other using keyword matching or LLM")
  .option("--dry-run", "Report what would be detected without writing to DB", false)
  .option("--concurrency <number>", "Parallel workers", "5")
  .action(async (opts: { dryRun: boolean; concurrency: string }) => {
    await enrichSubNicheCommand({ dryRun: opts.dryRun, concurrency: Number(opts.concurrency) });
  });

program
  .command("outreach")
  .description("Outreach management and reporting")
  .option("--stats", "Show outreach statistics (total, by status/channel/outcome, conversion/response rates)", false)
  .action(async (opts: { stats: boolean }) => {
    await outreachCommand({ stats: opts.stats });
  });

try {
  getScoringConfig();
  getDiscoveryConfig();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[blindspot] Config validation failed: ${msg}\n`);
  process.exit(1);
}

program.parse(process.argv);
