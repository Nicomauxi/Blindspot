import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { loadAllPassedLeads } from "../../storage/leads.js";
import { buildScoreEvalReport } from "../../modules/scoring/eval.js";
import { generateScoreEvalArtifacts } from "../../modules/reporting/score-eval.js";

const ScoreEvalArgsSchema = z.object({
  outputDir: z.string().min(1).optional(),
  top: z.coerce.number().int().min(10).max(200).default(50),
  goldSetSize: z.coerce.number().int().min(10).max(80).default(40),
});

interface RawScoreEvalArgs {
  outputDir?: string;
  top?: string | number;
  goldSetSize?: string | number;
}

function buildDefaultOutputDir(now: Date): string {
  const iso = now.toISOString().replaceAll(":", "").replaceAll(".", "").replace("Z", "Z");
  return join("reports", "22-eval", iso);
}

export async function scoreEvalCommand(rawArgs: RawScoreEvalArgs): Promise<void> {
  const log = getLogger();

  const parsed = ScoreEvalArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((issue) => `  ${issue.path.map(String).join(".")}: ${issue.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }

  const opts = parsed.data;
  const leads = await loadAllPassedLeads();
  if (leads.length === 0) {
    log.error("No passed leads found to evaluate");
    process.exit(1);
  }

  const generatedAt = new Date();
  const report = buildScoreEvalReport(leads, {
    topCount: opts.top,
    goldSetSize: opts.goldSetSize,
    generatedAt: generatedAt.toISOString(),
  });
  const artifacts = generateScoreEvalArtifacts(report);

  const outDir = opts.outputDir ?? buildDefaultOutputDir(generatedAt);
  await mkdir(outDir, { recursive: true });

  const files = [
    ["summary.md", artifacts.summaryMd],
    ["summary.json", artifacts.summaryJson],
    ["lead-deltas.csv", artifacts.leadDeltasCsv],
    ["top-v1.csv", artifacts.topV1Csv],
    ["top-v2.csv", artifacts.topV2Csv],
    ["top-50-comparison.csv", artifacts.topComparisonCsv],
    ["distribution-by-source.csv", artifacts.bySourceCsv],
    ["distribution-by-niche.csv", artifacts.byNicheCsv],
    ["distribution-by-contact-tier.csv", artifacts.byContactTierCsv],
    ["gold-set.seed.csv", artifacts.goldSetCsv],
  ] as const;

  for (const [filename, content] of files) {
    await writeFile(join(outDir, filename), content, "utf-8");
  }

  log.info(
    {
      outputDir: outDir,
      leads: report.meta.poolSize,
      tierXHot: report.criteria.tierXHot.count,
      cappedAt100Pct: report.criteria.cappedAt100.percent,
      topOverlap: report.topOverlapCount,
    },
    "score-eval report written"
  );

  console.log(`\nFase 22-eval complete`);
  console.log(`Leads evaluados: ${report.meta.poolSize}`);
  console.log(`Reporte: ${outDir}`);
  console.log(`Tier X >= 55: ${report.criteria.tierXHot.count}`);
  console.log(`Score 100: ${(report.criteria.cappedAt100.percent ?? 0).toFixed(2)}%`);
  console.log(`Avg franquicias: ${(report.criteria.franchiseAverage.avgV2 ?? 0).toFixed(1)}`);
  console.log(`Avg car_dealer contactables: ${(report.criteria.carDealerContactableAverage.avgV2 ?? 0).toFixed(1)}`);
  console.log(`Gold set seed: ${join(outDir, "gold-set.seed.csv")}`);
}
