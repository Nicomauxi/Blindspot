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
  updateLeadEnrichment,
} from "../../storage/leads.js";
import { loadFilterWordsForNiche } from "../../storage/vocabulary.js";
import { enrichLead } from "../../modules/enrichment/index.js";
import type { EnrichmentRunStats } from "../../shared/types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EnrichArgsSchema = z.object({
  run: z.string().regex(UUID_RE, "run must be a UUID"),
  forceRefresh: z.coerce.boolean().default(false),
  withHeuristic: z.coerce.boolean().default(false),
  concurrency: z.coerce.number().int().min(1).max(50).default(5),
});

interface RawEnrichArgs {
  run: string;
  forceRefresh: boolean | string;
  withHeuristic: boolean | string;
  concurrency: string | number;
}

export async function enrichCommand(rawArgs: RawEnrichArgs): Promise<void> {
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
  const effectiveConcurrency = opts.withHeuristic
    ? Math.min(opts.concurrency, 2)
    : opts.concurrency;

  const sourceRun = await getRunById(opts.run);
  if (!sourceRun) {
    log.error({ runId: opts.run }, "Source run not found");
    process.exit(1);
  }

  const startedAt = Date.now();
  log.info(
    {
      sourceRunId: sourceRun.id,
      forceRefresh: opts.forceRefresh,
      withHeuristic: opts.withHeuristic,
      concurrency: opts.concurrency,
      effectiveConcurrency,
    },
    "Starting enrich command"
  );
  log.info({ concurrency: effectiveConcurrency }, "Using effective enrich concurrency");

  const enrichRun = await createEnrichmentRun({
    sourceRun,
    forceRefresh: opts.forceRefresh,
    withHeuristic: opts.withHeuristic,
    concurrency: opts.concurrency,
  });
  log.info({ runId: enrichRun.id }, "Enrichment run created");

  try {
    const leads = await loadLeadsByRunId(sourceRun.id);
    log.info({ count: leads.length }, "Leads loaded");

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
        source_run_id: sourceRun.id,
        leads_processed: 0,
        skipped_no_website: 0,
        skipped_social_only: 0,
        skipped_cache_hit: 0,
        fetched_ok: 0,
        fetched_error: 0,
        whois_errors: 0,
      };
      await completeRun(enrichRun.id, stats);
      printSummary(enrichRun.id, stats);
      return;
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

    await Promise.all(
      leads.map((lead) =>
        limit(async () => {
          try {
            const extraStopWords = lead.niche
              ? (nicheStopWords.get(lead.niche) ?? new Set<string>())
              : new Set<string>();
            const result = await enrichLead(lead, {
              forceRefresh: opts.forceRefresh,
              withHeuristic: opts.withHeuristic,
              ...(extraStopWords.size > 0 ? { extraStopWords } : {}),
            });
            await updateLeadEnrichment(
              lead.id,
              result.digital_footprint,
              result.tags_to_add,
              result.whatsapp_from_site
            );

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
      source_run_id: sourceRun.id,
      leads_processed,
      skipped_no_website,
      skipped_social_only,
      skipped_cache_hit,
      fetched_ok,
      fetched_error,
      whois_errors,
    };
    await completeRun(enrichRun.id, stats);
    printSummary(enrichRun.id, stats);
  } catch (err: unknown) {
    const duration_ms = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ runId: enrichRun.id, err: msg }, "Enrich command failed");
    await failRun(enrichRun.id, msg, duration_ms);
    throw err;
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
Skipped (sin web):    ${stats.skipped_no_website}
Skipped (social):     ${stats.skipped_social_only}
Skipped (cache hit):  ${stats.skipped_cache_hit}
Fetch OK:             ${stats.fetched_ok}
Fetch error:          ${stats.fetched_error}
Whois errors:         ${stats.whois_errors}
Duración:             ${stats.duration_ms}ms
`);
}
