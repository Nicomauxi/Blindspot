import { z } from "zod";
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import {
  createEnrichmentRun,
  completeRun,
  failRun,
  getRunById,
} from "../../storage/runs.js";
import {
  loadLeadsByRunId,
  loadLeadsBySource,
  loadAllPassedLeads,
  loadLeadsByFilterSelection,
  updateLeadEnrichment,
  type EnrichmentLeadFilterSelection,
} from "../../storage/leads.js";
import { detectOwnerGroups } from "../../storage/owner-group.js";
import { recordPipelineError, type PipelineErrorType } from "../../storage/pipeline-errors.js";
import { loadFilterWordsForNiche } from "../../storage/vocabulary.js";
import { enrichLead } from "../../modules/enrichment/index.js";
import type { EnrichmentCtx } from "../../modules/enrichment/index.js";
import {
  detectAndSeedEmailProviders,
  detectAndSeedHeuristicDomains,
  loadAllRuntime,
  retroactiveEmailCleanup,
} from "../../storage/system-lists.js";
import type { AllRuntime } from "../../storage/system-lists.js";
import type { EnrichmentRunStats, Run } from "../../shared/types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const filterSelectionSchema = z.object({
  contact_tier: z.string().optional(),
  prospect_score_gte: z.number().int().min(0).max(100).optional(),
  niche: z.string().optional(),
  source: z.string().optional(),
  primary_offer: z.string().optional(),
  q: z.string().optional(),
});

const EnrichArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE).optional(),
    source: z.string().optional(),
    filters: filterSelectionSchema.optional(),
    all: z.coerce.boolean().default(false),
    forceRefresh: z.coerce.boolean().default(false),
    withHeuristic: z.coerce.boolean().default(false),
    concurrency: z.coerce.number().int().min(1).max(50).default(5),
  })
  .superRefine((args, ctx) => {
    const modeCount = [!!args.run, !!args.source, !!args.filters, args.all].filter(Boolean).length;
    if (modeCount === 0) {
      ctx.addIssue({
        code: "custom",
        message: "One of --run <uuid>, --source <source>, --filters <selection>, or --all is required",
      });
    }
    if (modeCount > 1) {
      ctx.addIssue({
        code: "custom",
        message: "--run, --source, --filters, and --all are mutually exclusive",
      });
    }
  });

interface RawEnrichArgs {
  run?: string;
  source?: string;
  filters?: EnrichmentLeadFilterSelection;
  forceRefresh: boolean | string;
  withHeuristic: boolean | string;
  concurrency: string | number;
  all?: boolean | string;
}

interface EnrichExecutionOptions {
  mode: "run" | "source" | "all" | "filter";
  sourceRun?: Run;
  source?: string;
  filters?: EnrichmentLeadFilterSelection;
  forceRefresh: boolean;
  withHeuristic: boolean;
  concurrency: number;
  // Cap heurístico explícito (UI/API). Si falta, rige ENRICH_HEURISTIC_MAX_CONCURRENCY.
  heuristicConcurrency?: number;
  // Tope de leads en modo filter. Default 250 (selección); scope=all lo sube desde la API.
  filterLimit?: number;
}

const FILTER_MODE_DEFAULT_LIMIT = 250;

// El modo heurístico dispara muchos sub-requests por lead, por eso se capa la concurrencia.
// El cap puede venir explícito (heuristicConcurrency, desde la UI) o por env
// (ENRICH_HEURISTIC_MAX_CONCURRENCY, default 2) para reprocesos por CLI.
export function resolveEffectiveConcurrency(opts: {
  withHeuristic: boolean;
  concurrency: number;
  heuristicConcurrency?: number;
}): number {
  if (!opts.withHeuristic) return opts.concurrency;
  const cap =
    opts.heuristicConcurrency ??
    Math.max(1, Number(process.env["ENRICH_HEURISTIC_MAX_CONCURRENCY"] ?? "2"));
  return Math.min(opts.concurrency, cap);
}

function normalizeFilterSelection(
  filters:
    | EnrichmentLeadFilterSelection
    | {
        contact_tier?: string | undefined;
        prospect_score_gte?: number | undefined;
        niche?: string | undefined;
        source?: string | undefined;
        primary_offer?: string | undefined;
        q?: string | undefined;
      }
    | undefined
): EnrichmentLeadFilterSelection {
  if (!filters) return {};

  return {
    ...(filters.contact_tier ? { contact_tier: filters.contact_tier } : {}),
    ...(filters.prospect_score_gte != null ? { prospect_score_gte: filters.prospect_score_gte } : {}),
    ...(filters.niche ? { niche: filters.niche } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.primary_offer ? { primary_offer: filters.primary_offer } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
}

function optionalSet<T>(values: ReadonlySet<T> | undefined): ReadonlySet<T> | undefined {
  return values && values.size > 0 ? values : undefined;
}

function optionalArray<T>(values: readonly T[]): readonly T[] | undefined {
  return values.length > 0 ? values : undefined;
}

function optionalMap<K, V>(values: ReadonlyMap<K, V>): ReadonlyMap<K, V> | undefined {
  return values.size > 0 ? values : undefined;
}

function unionSets<T>(...sets: Array<ReadonlySet<T> | undefined>): ReadonlySet<T> | undefined {
  const merged = new Set<T>();
  for (const set of sets) {
    for (const value of set ?? []) merged.add(value);
  }
  return merged.size > 0 ? merged : undefined;
}

function classifyPipelineError(message: string): PipelineErrorType {
  const normalized = message.toLowerCase();
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("429")) return "http_429";
  if (normalized.includes("captcha")) return "captcha";
  if (normalized.includes("blocked")) return "blocked";
  if (normalized.includes("parse")) return "parse_failed";
  if (normalized.includes("db")) return "db_error";
  return "other";
}

function buildRuntimeCtx(runtime: AllRuntime, niche: string | null): EnrichmentCtx {
  const runtimeNicheStopWords = unionSets(
    runtime.mappings.nicheStopWords.get("all"),
    niche ? runtime.mappings.nicheStopWords.get(niche) : undefined
  );
  const blockedDomains = optionalSet(runtime.lists.blockedEmailDomains);
  const freeDomains = optionalSet(runtime.lists.freeEmailDomains);
  const blockedPrefixes = optionalArray(runtime.lists.blockedEmailPrefixes);
  const foreignEmailTlds = optionalSet(runtime.lists.foreignEmailTlds);
  const foreignTlds = optionalSet(runtime.lists.foreignTlds);
  const foreignGeoTerms = optionalArray(runtime.lists.foreignGeoTerms);
  const foreignPhonePrefixes = optionalArray(runtime.lists.foreignPhonePrefixes);
  const bookingPlatforms = optionalArray(runtime.patterns.booking);
  const ecommercePlatforms = optionalArray(runtime.patterns.ecommercePlatforms);
  const reservationPlatforms = optionalArray(runtime.patterns.reservation);
  const deliveryPlatforms = optionalArray(runtime.patterns.delivery);
  const classBookingPlatforms = optionalArray(runtime.patterns.classBooking);
  const appStorePlatforms = optionalArray(runtime.patterns.appStore.map((p) => p.pattern));
  const menuKeywords = optionalArray(runtime.patterns.menuKeywords);
  const catalogKeywords = optionalArray(runtime.patterns.catalogKeywords);
  const chatWidgetPatterns = optionalArray(runtime.patterns.chatWidgets);
  const stopWords = optionalSet(runtime.lists.stopWords);
  const descriptorWords = optionalMap(runtime.mappings.descriptorWords);
  const blockedHeuristicDomains = optionalSet(runtime.lists.blockedHeuristicDomains);

  return {
    emailCtx: {
      ...(blockedDomains ? { blockedDomains } : {}),
      ...(freeDomains ? { freeDomains } : {}),
      ...(blockedPrefixes ? { blockedPrefixes } : {}),
      ...(foreignEmailTlds ? { foreignEmailTlds } : {}),
    },
    geoCtx: {
      ...(foreignTlds ? { foreignTlds } : {}),
      ...(foreignGeoTerms ? { foreignGeoTerms } : {}),
      ...(foreignPhonePrefixes ? { foreignPhonePrefixes } : {}),
    },
    operationalCtx: {
      ...(bookingPlatforms ? { bookingPlatforms } : {}),
      ...(reservationPlatforms ? { reservationPlatforms } : {}),
      ...(deliveryPlatforms ? { deliveryPlatforms } : {}),
      ...(classBookingPlatforms ? { classBookingPlatforms } : {}),
      ...(appStorePlatforms ? { appStorePlatforms } : {}),
      ...(menuKeywords ? { menuKeywords } : {}),
      ...(catalogKeywords ? { catalogKeywords } : {}),
      ...(chatWidgetPatterns ? { chatWidgetPatterns } : {}),
      ...(ecommercePlatforms ? { ecommercePlatforms } : {}),
    },
    heuristicListsCtx: {
      ...(stopWords ? { stopWords } : {}),
      ...(runtimeNicheStopWords ? { nicheStopWords: runtimeNicheStopWords } : {}),
      ...(descriptorWords ? { descriptorWords } : {}),
      ...(blockedHeuristicDomains ? { blockedHeuristicDomains } : {}),
    },
  };
}

export interface EnrichCommandResult {
  runId: string;
  stats: EnrichmentRunStats;
}

async function executeEnrichmentRun(
  options: EnrichExecutionOptions,
  enrichRun: Run
): Promise<EnrichCommandResult> {
  const log = getLogger();
  const startedAt = Date.now();
  const effectiveConcurrency = resolveEffectiveConcurrency(options);

  try {
    const runtime = await loadAllRuntime();
    const leads =
      options.mode === "run"
        ? await loadLeadsByRunId(options.sourceRun!.id, { passedOnly: true })
        : options.mode === "source"
          ? await loadLeadsBySource(options.source!, { passedOnly: true })
          : options.mode === "filter"
            ? await loadLeadsByFilterSelection(options.filters ?? {}, {
                passedOnly: true,
                limit: options.filterLimit ?? FILTER_MODE_DEFAULT_LIMIT,
              })
            : await loadAllPassedLeads();
    log.info({ count: leads.length, mode: options.mode }, "Leads loaded");

    if (leads.length === 0) {
      const duration_ms = Date.now() - startedAt;
      const stats: EnrichmentRunStats = {
        places_requests: 0,
        estimated_cost_usd: 0,
        leads_discovered: 0,
        leads_new: 0,
        leads_updated: 0,
        duration_ms,
        command: "enrich",
        ...(options.mode === "run" ? { source_run_id: options.sourceRun!.id } : {}),
        leads_processed: 0,
        significant_changes: 0,
        skipped_no_website: 0,
        skipped_social_only: 0,
        skipped_cache_hit: 0,
        fetched_ok: 0,
        fetched_error: 0,
        whois_errors: 0,
      };
      await completeRun(enrichRun.id, stats);
      printSummary(enrichRun.id, stats);
      return { runId: enrichRun.id, stats };
    }

    const uniqueNiches = [...new Set(
      leads.map((l) => l.niche).filter((n): n is string => !!n)
    )];
    const nicheStopWords = new Map<string, Set<string>>();
    for (const niche of uniqueNiches) {
      try {
        nicheStopWords.set(niche, await loadFilterWordsForNiche(niche));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ niche, err: msg }, "vocabulary load failed — proceeding without extra stop-words");
        nicheStopWords.set(niche, new Set());
      }
    }
    log.info({ niches: uniqueNiches.length }, "vocabulary loaded for enrichment run");

    const limit = pLimit(effectiveConcurrency);
    const total = leads.length;
    let done = 0;

    let skipped_no_website = 0;
    let skipped_social_only = 0;
    let skipped_cache_hit = 0;
    let fetched_ok = 0;
    let fetched_error = 0;
    let whois_errors = 0;
    let leads_processed = 0;
    let significant_changes = 0;

    await Promise.all(
      leads.map((lead) =>
        limit(async () => {
          try {
            const extraStopWords = lead.niche
              ? (nicheStopWords.get(lead.niche) ?? new Set<string>())
              : new Set<string>();
            const leadRuntimeCtx = buildRuntimeCtx(runtime, lead.niche);
            const result = await enrichLead(lead, {
              forceRefresh: options.forceRefresh,
              withHeuristic: options.withHeuristic,
              ...(extraStopWords.size > 0 ? { extraStopWords } : {}),
            }, undefined, leadRuntimeCtx);
            const enrichmentUpdate = await updateLeadEnrichment(
              lead.id,
              result.digital_footprint,
              result.tags_to_add,
              result.whatsapp_from_site,
              result.inferred_state
            );
            if (enrichmentUpdate?.critical_change) {
              significant_changes += 1;
            }

            switch (result.outcome) {
              case "skipped-no-website":
                skipped_no_website += 1;
                break;
              case "skipped-social":
                skipped_social_only += 1;
                break;
              case "cache-hit":
                skipped_cache_hit += 1;
                break;
              case "fetched-ok":
                fetched_ok += 1;
                break;
              case "fetched-error":
                fetched_error += 1;
                break;
            }

            const fp = result.digital_footprint;
            if (
              fp &&
              (fp as { skipped?: true }).skipped !== true &&
              (fp as { whois?: { error?: string } }).whois?.error
            ) {
              whois_errors += 1;
            }

            leads_processed += 1;
            done += 1;
            const signalCount = countSignals(result.digital_footprint);
            log.info(
              {
                progress: `${done}/${total}`,
                leadId: lead.id,
                outcome: result.outcome,
                signals: signalCount,
                tags: result.tags_to_add.length,
              },
              `[${done}/${total}] enriched ${lead.name}`
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error({ leadId: lead.id, err: msg }, "lead enrichment crashed");
            try {
              await recordPipelineError({
                run_id: enrichRun.id,
                phase: "enrich",
                source: lead.source,
                lead_id: lead.id,
                error_type: classifyPipelineError(msg),
                message: msg,
                stack: err instanceof Error ? err.stack ?? null : null,
                recovered: true,
              });
            } catch (pipelineErr: unknown) {
              const pipelineMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
              log.warn({ leadId: lead.id, err: pipelineMsg }, "pipeline_errors insert failed");
            }
          }
        })
      )
    );

    const duration_ms = Date.now() - startedAt;
    const stats: EnrichmentRunStats = {
      places_requests: 0,
      estimated_cost_usd: 0,
      leads_discovered: 0,
      leads_new: 0,
      leads_updated: leads_processed,
      duration_ms,
      command: "enrich",
      ...(options.mode === "run" ? { source_run_id: options.sourceRun!.id } : {}),
      leads_processed,
      significant_changes,
      skipped_no_website,
      skipped_social_only,
      skipped_cache_hit,
      fetched_ok,
      fetched_error,
      whois_errors,
    };
    await completeRun(enrichRun.id, stats);
    if (leads_processed > 0) {
      try {
        const ownerGroups = await detectOwnerGroups();
        if (ownerGroups.leads_assigned > 0) {
          log.info(ownerGroups, "owner groups refreshed after enrichment");
        }
        const seeded = await detectAndSeedEmailProviders();
        if (seeded > 0) {
          log.info({ count: seeded }, "email provider domains auto-detected after enrichment");
        }
        const cleaned = await retroactiveEmailCleanup();
        if (cleaned > 0) {
          log.info({ count: cleaned }, "retroactiveEmailCleanup — stale emails removed from leads");
        }
        if (typeof detectAndSeedHeuristicDomains === "function") {
          const newHeuristicBlocked = await detectAndSeedHeuristicDomains();
          if (newHeuristicBlocked > 0) {
            log.info({ count: newHeuristicBlocked }, "Auto-detected new blocked heuristic domains");
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg }, "email provider auto-detection failed — skipping");
      }
    }
    printSummary(enrichRun.id, stats);
    return { runId: enrichRun.id, stats };
  } catch (err: unknown) {
    const duration_ms = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ runId: enrichRun.id, err: msg }, "Enrich command failed");
    await failRun(enrichRun.id, msg, duration_ms);
    throw err;
  }
}

export async function startFilterEnrichmentJob(params: {
  filters: EnrichmentLeadFilterSelection;
  withHeuristic: boolean;
  concurrency: number;
  forceRefresh?: boolean;
  heuristicConcurrency?: number;
  leadLimit?: number;
}): Promise<{ runId: string }> {
  const enrichRun = await createEnrichmentRun({
    mode: "filter",
    filters: params.filters,
    forceRefresh: params.forceRefresh ?? false,
    withHeuristic: params.withHeuristic,
    concurrency: params.concurrency,
  });

  void executeEnrichmentRun({
    mode: "filter",
    filters: params.filters,
    forceRefresh: params.forceRefresh ?? false,
    withHeuristic: params.withHeuristic,
    concurrency: params.concurrency,
    ...(params.heuristicConcurrency !== undefined
      ? { heuristicConcurrency: params.heuristicConcurrency }
      : {}),
    ...(params.leadLimit !== undefined ? { filterLimit: params.leadLimit } : {}),
  }, enrichRun).catch((err) => {
    const log = getLogger();
    log.error({ runId: enrichRun.id, err: err instanceof Error ? err.message : String(err) }, "Background filter enrichment failed");
  });

  return { runId: enrichRun.id };
}

export async function enrichCommand(rawArgs: RawEnrichArgs): Promise<EnrichCommandResult> {
  const log = getLogger();

  const parsed = EnrichArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }
  const opts = parsed.data;

  const mode = opts.run ? "run" : opts.source ? "source" : opts.filters ? "filter" : "all";
  const normalizedFilters = normalizeFilterSelection(opts.filters);

  let sourceRun: import("../../shared/types.js").Run | undefined;
  if (mode === "run") {
    const found = await getRunById(opts.run!);
    if (!found) {
      log.error({ runId: opts.run }, "Source run not found");
      process.exit(1);
    }
    sourceRun = found;
  }

  log.info(
    {
      mode,
      ...(mode === "run" ? { sourceRunId: sourceRun!.id } : {}),
      ...(mode === "source" ? { source: opts.source } : {}),
      ...(mode === "filter" ? { filters: normalizedFilters } : {}),
      forceRefresh: opts.forceRefresh,
      withHeuristic: opts.withHeuristic,
      concurrency: opts.concurrency,
    },
    "Starting enrich command"
  );

  const executionOptions: EnrichExecutionOptions =
    mode === "run"
      ? {
          mode: "run",
          sourceRun: sourceRun!,
          forceRefresh: opts.forceRefresh,
          withHeuristic: opts.withHeuristic,
          concurrency: opts.concurrency,
        }
      : mode === "source"
        ? {
            mode: "source",
            source: opts.source!,
            forceRefresh: opts.forceRefresh,
            withHeuristic: opts.withHeuristic,
            concurrency: opts.concurrency,
          }
        : mode === "filter"
          ? {
              mode: "filter",
              filters: normalizedFilters,
              forceRefresh: opts.forceRefresh,
              withHeuristic: opts.withHeuristic,
              concurrency: opts.concurrency,
            }
          : {
              mode: "all",
              forceRefresh: opts.forceRefresh,
              withHeuristic: opts.withHeuristic,
              concurrency: opts.concurrency,
            };

  const enrichRun = await createEnrichmentRun(executionOptions);
  log.info({ runId: enrichRun.id }, "Enrichment run created");

  const cleanup = async (signal: string) => {
    log.warn({ runId: enrichRun.id, signal }, "Process interrupted, marking run as failed");
    try {
      await failRun(enrichRun.id, `Process interrupted (${signal})`, 1);
    } catch {
      // best effort
    }
    process.exit(1);
  };
  const onSigterm = () => void cleanup("SIGTERM");
  const onSigint = () => void cleanup("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  try {
    return await executeEnrichmentRun(executionOptions, enrichRun);
  } finally {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
  }
}

function countSignals(fp: unknown): number {
  if (!fp || typeof fp !== "object") return 0;
  const obj = fp as Record<string, unknown>;
  if (obj.skipped === true) return 0;
  let n = 0;
  for (const k of [
    "ssl",
    "pixels",
    "stack",
    "viewport",
    "whatsapp",
    "social_links",
    "whois",
    "http_status",
    "final_url",
  ]) {
    if (obj[k] !== undefined && obj[k] !== null) n += 1;
  }
  return n;
}

function printSummary(runId: string, stats: EnrichmentRunStats): void {
  console.log(`
Enrichment run ${runId} completado.
Procesados:           ${stats.leads_processed}
Cambios significativos: ${stats.significant_changes}
Skipped (sin web):    ${stats.skipped_no_website}
Skipped (social):     ${stats.skipped_social_only}
Skipped (cache hit):  ${stats.skipped_cache_hit}
Fetch OK:             ${stats.fetched_ok}
Fetch error:          ${stats.fetched_error}
Whois errors:         ${stats.whois_errors}
Duración:             ${stats.duration_ms}ms
`);
}
