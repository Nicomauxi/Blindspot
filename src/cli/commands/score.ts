import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { loadLeadsByRunId, loadAllLeads, loadAllPassedLeads, updateLeadScore, upsertBuyerScores, tagDuplicates, tagFranchises, propagateChainWebsites } from "../../storage/leads.js";
import { loadRuntimeLists } from "../../storage/system-lists.js";
import { createScoringRun, completeScoringRun, failRun, getRunById } from "../../storage/runs.js";
import { scoreLead } from "../../modules/scoring/index.js";
import { computeAllBuyerScores } from "../../modules/scoring/buyer-types.js";
import { getAdminServicePricing } from "../../storage/service-pricing.js";
import type { Lead, ScoringRunStats, ProspectEntry } from "../../shared/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ScoreArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE, "run must be a UUID").optional(),
    all: z.boolean().default(false),
    buyerTypes: z.boolean().default(false),
    buyerType: z.string().optional(),
    dryRun: z.coerce.boolean().default(false),
  })
  .superRefine((args, ctx) => {
    if (!args.run && !args.all && !args.buyerTypes) {
      ctx.addIssue({ code: "custom", message: "Either --run <uuid>, --all, or --buyer-types is required" });
    }
    if (args.run && args.all) {
      ctx.addIssue({ code: "custom", message: "--run and --all are mutually exclusive" });
    }
    if (args.buyerType && !args.buyerTypes) {
      ctx.addIssue({ code: "custom", message: "--buyer-type requires --buyer-types" });
    }
  });

interface RawScoreArgs {
  run?: string;
  all?: boolean;
  buyerTypes?: boolean;
  buyerType?: string;
  dryRun?: boolean;
}

export function buildTopBottom(scored: Array<{ lead: Lead; prospectScore: number }>): {
  top_5: ProspectEntry[];
  bottom_5: ProspectEntry[];
} {
  const entries: ProspectEntry[] = scored.map(({ lead, prospectScore }) => ({
    place_id: lead.place_id,
    name: lead.name,
    prospect_score: prospectScore,
  }));

  const comparator = (a: ProspectEntry, b: ProspectEntry, asc: boolean): number => {
    const diff = asc
      ? a.prospect_score - b.prospect_score
      : b.prospect_score - a.prospect_score;
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  };

  const n = Math.min(5, entries.length);
  const top_5 = [...entries].sort((a, b) => comparator(a, b, false)).slice(0, n);
  const bottom_5 = [...entries].sort((a, b) => comparator(a, b, true)).slice(0, n);

  return { top_5, bottom_5 };
}

async function scoreBuyerTypes(opts: { buyerType?: string; dryRun: boolean }): Promise<void> {
  const log = getLogger();
  const leads = await loadAllPassedLeads();
  const eligible = leads.filter((l) => l.score_breakdown?.sub_scores != null);

  log.info({ total: eligible.length }, "Computing buyer-type scores");

  const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
  const buyerScoreOpts = deliverySystemCostUyu != null ? { deliverySystemCostUyu } : {};

  let processed = 0;
  for (const lead of eligible) {
    let scores = computeAllBuyerScores(lead, buyerScoreOpts);
    if (opts.buyerType) {
      scores = scores.filter((s) => s.buyer_type === opts.buyerType);
    }
    if (!opts.dryRun) {
      await upsertBuyerScores(lead.id, scores);
    }
    processed++;
    if (processed % 100 === 0) {
      log.info({ processed, total: eligible.length }, "buyer-type scoring progress");
    }
  }

  log.info({ processed, dry_run: opts.dryRun }, "Buyer-type scoring complete");
}

export interface ScoreCommandResult {
  leads_loaded: number;
  leads_scored: number;
}

export async function scoreCommand(rawArgs: RawScoreArgs): Promise<ScoreCommandResult> {
  const log = getLogger();

  const parsed = ScoreArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }

  const opts = parsed.data;
  const startedAt = Date.now();

  let sourceRun = undefined;
  if (opts.run) {
    const found = await getRunById(opts.run);
    if (!found) {
      log.error({ runId: opts.run }, "Source run not found");
      process.exit(1);
    }
    sourceRun = found;
  }

  const scoringRun = await createScoringRun({
    scope: opts.all || opts.buyerTypes ? "all" : "run",
    ...(sourceRun ? { sourceRun } : {}),
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    log.info({ runId: scoringRun.id }, "dry-run mode — scores will not be persisted");
  }

  try {
    const scored: Array<{ lead: Lead; prospectScore: number }> = [];
    let leadsLoaded = 0;
    const warnings: string[] = [];
    const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
    const buyerScoreOpts = deliverySystemCostUyu != null ? { deliverySystemCostUyu } : {};

    if (opts.run || opts.all) {
      const leads = opts.all
        ? await loadAllLeads()
        : await loadLeadsByRunId(opts.run!);

      leadsLoaded = leads.length;
      log.info({ total: leads.length }, "Loaded leads to score");

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i]!;
        const result = scoreLead(lead);
        const leadWithScore: Lead = {
          ...lead,
          business_quality_score: result.business_quality_score,
          digital_gap_score: result.digital_gap_score,
          systems_gap_score: result.systems_gap_score,
          prospect_score: result.prospect_score,
          scoring_version: result.scoring_version,
          contact_ready: result.contact_ready,
          score_breakdown: result.score_breakdown as unknown as Record<string, unknown>,
          systems_gap_breakdown: result.systems_gap_breakdown as unknown as Record<string, unknown>,
        };
        let buyerScores = computeAllBuyerScores(leadWithScore, buyerScoreOpts);
        if (opts.buyerType) {
          buyerScores = buyerScores.filter((score) => score.buyer_type === opts.buyerType);
        }

        log.info(
          `[${i + 1}/${leads.length}] scored ${lead.name} → bq=${result.business_quality_score} dg=${result.digital_gap_score} sg=${result.systems_gap_score} prospect=${result.prospect_score}`
        );

        if (!opts.dryRun) {
          await updateLeadScore(lead.id, result);
          await upsertBuyerScores(lead.id, buyerScores);
        }

        scored.push({ lead, prospectScore: result.prospect_score });
      }

      if (!opts.dryRun) {
        const leadsWithScore = scored.map(({ lead, prospectScore }) => ({
          ...lead,
          prospect_score: prospectScore,
        }));

        try {
          await tagDuplicates(leadsWithScore);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`duplicate_tagging: ${msg}`);
          log.warn({ error: msg }, "Duplicate tagging failed after scoring; scores remain persisted");
        }

        try {
          const runtimeLists = await loadRuntimeLists();
          await tagFranchises(leadsWithScore, runtimeLists.franchiseNames);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`franchise_tagging: ${msg}`);
          log.warn({ error: msg }, "Franchise tagging failed after scoring; scores remain persisted");
        }

        try {
          const propagated = await propagateChainWebsites(leadsWithScore);
          if (propagated > 0) log.info({ propagated }, "Chain website propagation applied");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`chain_website_propagation: ${msg}`);
          log.warn({ error: msg }, "Chain website propagation failed after scoring; scores remain persisted");
        }
      }
    }

    if (opts.buyerTypes && !(opts.run || opts.all)) {
      await scoreBuyerTypes({ ...(opts.buyerType ? { buyerType: opts.buyerType } : {}), dryRun: opts.dryRun });
    }

    const duration_ms = Date.now() - startedAt;
    const { top_5, bottom_5 } = buildTopBottom(scored);

    const stats: ScoringRunStats = {
      command: "score",
      scope: opts.all || opts.buyerTypes ? "all" : "run",
      ...(sourceRun ? { source_run_id: sourceRun.id } : {}),
      dry_run: opts.dryRun,
      leads_scored: scored.length,
      duration_ms,
      top_5,
      bottom_5,
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    await completeScoringRun(scoringRun.id, stats);

    log.info(
      { runId: scoringRun.id, leads_scored: scored.length, duration_ms, dry_run: opts.dryRun },
      "Scoring run completed"
    );

    if (top_5.length > 0) {
      log.info({ top_5 }, "Top prospects");
    }
    // N43: devolver el trabajo REAL para que la fase score del pipeline pueda marcar
    // partial/failed cuando lo procesado no coincide con lo cargado.
    return { leads_loaded: leadsLoaded, leads_scored: scored.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(scoringRun.id, msg, Date.now() - startedAt);
    throw err;
  }
}
