import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { loadLeadsByRunId, loadAllLeads, updateLeadScore } from "../../storage/leads.js";
import { createScoringRun, completeScoringRun, failRun, getRunById } from "../../storage/runs.js";
import { scoreLead } from "../../modules/scoring/index.js";
import type { Lead, ScoringRunStats, ProspectEntry } from "../../shared/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ScoreArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE, "run must be a UUID").optional(),
    all: z.boolean().default(false),
    dryRun: z.coerce.boolean().default(false),
  })
  .superRefine((args, ctx) => {
    if (!args.run && !args.all) {
      ctx.addIssue({ code: "custom", message: "Either --run <uuid> or --all is required" });
    }
    if (args.run && args.all) {
      ctx.addIssue({ code: "custom", message: "--run and --all are mutually exclusive" });
    }
  });

interface RawScoreArgs {
  run?: string;
  all?: boolean;
  dryRun?: boolean;
}

function buildTopBottom(scored: Array<{ lead: Lead; prospectScore: number }>): {
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

export async function scoreCommand(rawArgs: RawScoreArgs): Promise<void> {
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
    scope: opts.all ? "all" : "run",
    ...(sourceRun ? { sourceRun } : {}),
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    log.info({ runId: scoringRun.id }, "dry-run mode — scores will not be persisted");
  }

  try {
    const leads = opts.all
      ? await loadAllLeads()
      : await loadLeadsByRunId(opts.run!);

    log.info({ total: leads.length }, "Loaded leads to score");

    const scored: Array<{ lead: Lead; prospectScore: number }> = [];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]!;
      const result = scoreLead(lead);

      log.info(
        `[${i + 1}/${leads.length}] scored ${lead.name} → bq=${result.business_quality_score} dg=${result.digital_gap_score} prospect=${result.prospect_score}`
      );

      if (!opts.dryRun) {
        await updateLeadScore(lead.id, result);
      }

      scored.push({ lead, prospectScore: result.prospect_score });
    }

    const duration_ms = Date.now() - startedAt;
    const { top_5, bottom_5 } = buildTopBottom(scored);

    const stats: ScoringRunStats = {
      command: "score",
      scope: opts.all ? "all" : "run",
      ...(sourceRun ? { source_run_id: sourceRun.id } : {}),
      dry_run: opts.dryRun,
      leads_scored: scored.length,
      duration_ms,
      top_5,
      bottom_5,
    };

    await completeScoringRun(scoringRun.id, stats);

    log.info(
      { runId: scoringRun.id, leads_scored: scored.length, duration_ms, dry_run: opts.dryRun },
      "Scoring run completed"
    );

    if (top_5.length > 0) {
      log.info({ top_5 }, "Top prospects");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(scoringRun.id, msg, Date.now() - startedAt);
    throw err;
  }
}
