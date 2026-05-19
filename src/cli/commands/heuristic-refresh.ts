import { z } from "zod";
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import { getDiscoveryConfig } from "../../modules/discovery/config.js";
import { isSocialOrMissingWeb } from "../../modules/discovery/filters.js";
import { enrichLead } from "../../modules/enrichment/index.js";
import { isHeuristicStale } from "../../modules/enrichment/heuristic-discovery.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadEnrichment,
} from "../../storage/leads.js";
import { loadVocabularyForNiche } from "../../storage/vocabulary.js";
import { getRunById } from "../../storage/runs.js";
import type { DigitalFootprint, Lead } from "../../shared/types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE, "run must be a UUID").optional(),
    all: z.coerce.boolean().default(false),
    force: z.coerce.boolean().default(false),
    concurrency: z.coerce.number().int().min(1).max(50).default(5),
  })
  .superRefine((data, ctx) => {
    const scopes = [data.run !== undefined, data.all === true].filter(Boolean).length;
    if (scopes !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "provide exactly one of --run or --all",
        path: ["run"],
      });
    }
  });

interface RawArgs {
  run?: string;
  all: boolean | string;
  force: boolean | string;
  concurrency: string | number;
}

function existingHeuristic(fp: DigitalFootprint | null) {
  return fp?.heuristic_discovery ?? null;
}

function hasConfirmedRealWebsite(lead: Lead): boolean {
  if (!lead.website || lead.website.trim() === "") return false;
  return !isSocialOrMissingWeb(lead.website, getDiscoveryConfig().social_domains);
}

function shouldProcess(lead: Lead, force: boolean): boolean {
  if (!lead.passed_filter) return false;
  if (hasConfirmedRealWebsite(lead)) return false;
  if (force) return true;
  return isHeuristicStale(existingHeuristic(lead.digital_footprint));
}

export async function heuristicRefreshCommand(rawArgs: RawArgs): Promise<void> {
  const log = getLogger();
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }
  const opts = parsed.data;

  if (opts.run) {
    const sourceRun = await getRunById(opts.run);
    if (!sourceRun) {
      log.error({ runId: opts.run }, "Source run not found");
      process.exit(1);
    }
  }

  const leads = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const selected = leads.filter((lead) => shouldProcess(lead, opts.force));

  log.info(
    {
      scope: opts.run ? "run" : "all",
      runId: opts.run ?? null,
      force: opts.force,
      loaded: leads.length,
      selected: selected.length,
      concurrency: opts.concurrency,
    },
    "Starting heuristic refresh"
  );

  // Load niche vocabulary once per unique niche (graceful degradation: errors → empty set).
  const uniqueNiches = new Set(
    selected.map((l) => l.niche).filter((n): n is string => n !== null && n !== "all")
  );
  const nicheVocab = new Map<string, ReadonlySet<string>>();
  for (const niche of uniqueNiches) {
    nicheVocab.set(niche, await loadVocabularyForNiche(niche));
  }

  const limit = pLimit(opts.concurrency);
  let processed = 0;
  let errors = 0;

  await Promise.all(
    selected.map((lead) =>
      limit(async () => {
        try {
          const extraStopWords: ReadonlySet<string> =
            lead.niche != null ? (nicheVocab.get(lead.niche) ?? new Set()) : new Set();
          const result = await enrichLead(lead, {
            forceRefresh: opts.force,
            withHeuristic: true,
            ...(extraStopWords.size > 0 ? { extraStopWords } : {}),
          });
          await updateLeadEnrichment(
            lead.id,
            result.digital_footprint,
            result.tags_to_add,
            result.whatsapp_from_site,
            result.inferred_state
          );
          processed += 1;
          log.info(
            {
              leadId: lead.id,
              outcome: result.outcome,
              tags: result.tags_to_add,
            },
            "heuristic refresh processed lead"
          );
        } catch (err: unknown) {
          errors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ leadId: lead.id, err: msg }, "heuristic refresh failed for lead");
        }
      })
    )
  );

  console.log(`
Heuristic refresh completado.
Candidatos cargados: ${leads.length}
Seleccionados:       ${selected.length}
Procesados:          ${processed}
Errores:             ${errors}
`);
}
