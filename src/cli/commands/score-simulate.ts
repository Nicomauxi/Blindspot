import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getScoringCalibrationConfig } from "../../modules/scoring/calibration-config.js";
import { buildCalibrationScenarioReport, buildGoldSetSeed, parseGoldSetCsv, toCsv } from "../../modules/scoring/simulate.js";
import { loadLeadsByScoringVersion } from "../../storage/leads.js";

const ArgsSchema = z.object({
  scenario: z.string().optional(),
  outputDir: z.string().optional(),
  goldSet: z.string().optional(),
  goldSetSize: z.coerce.number().int().min(20).max(200).default(80),
});

interface RawArgs {
  scenario?: string;
  outputDir?: string;
  goldSet?: string;
  goldSetSize?: string | number;
}

function defaultOutDir(now: Date): string {
  return join("reports", "scoring-calibration", now.toISOString().replaceAll(":", "").replaceAll(".", ""));
}

function buildSummary(report: ReturnType<typeof buildCalibrationScenarioReport>): string {
  return [
    `# Scoring calibration — ${report.scenario}`,
    "",
    `Family: ${report.family}`,
    `Macro-F1: ${report.macro_f1 ?? "n/a"}`,
    `Top-50 overlap: ${report.top_overlap}`,
    `Score 100 count: ${report.score_100_count}`,
    `Thresholds: good>=${report.thresholds.good_min}, very_good>=${report.thresholds.very_good_min}, exceptional>=${report.thresholds.exceptional_min}`,
    "",
    "## Rank stability",
    ...report.rank_stability.map((row) => `- ${row.cohort}: n=${row.size}, spearman=${row.spearman}, overlap=${row.top20_overlap}, avg_abs_rank_delta=${row.avg_abs_rank_delta}`),
    "",
    "## Top concentration",
    ...report.concentration.slice(0, 10).map((row) => `- ${row.source} / ${row.niche} / ${row.primary_offer}: exceptional=${row.exceptional_count}, total=${row.total_count}`),
  ].join("\n");
}

export async function scoreSimulateCommand(rawArgs: RawArgs): Promise<void> {
  const parsed = ArgsSchema.parse(rawArgs);
  const calibration = getScoringCalibrationConfig();
  const scenarioNames = parsed.scenario ? [parsed.scenario] : Object.keys(calibration.scenarios);
  const unknown = scenarioNames.filter((name) => !(name in calibration.scenarios));
  if (unknown.length > 0) throw new Error(`Unknown calibration scenario(s): ${unknown.join(", ")}`);

  const goldSet = parsed.goldSet
    ? parseGoldSetCsv(await readFile(parsed.goldSet, "utf8"))
    : [];
  const leads = await loadLeadsByScoringVersion(2);
  const outDir = parsed.outputDir ?? defaultOutDir(new Date());
  await mkdir(outDir, { recursive: true });

  const indexRows: Array<Record<string, string | number | null>> = [];

  for (const scenarioName of scenarioNames) {
    const scenario = calibration.scenarios[scenarioName]!;
    const report = buildCalibrationScenarioReport(leads, scenarioName, scenario, goldSet);
    const scenarioDir = join(outDir, scenarioName);
    await mkdir(scenarioDir, { recursive: true });

    await writeFile(join(scenarioDir, "summary.md"), buildSummary(report), "utf8");
    await writeFile(join(scenarioDir, "summary.json"), JSON.stringify(report, null, 2), "utf8");
    await writeFile(join(scenarioDir, "lead-results.csv"), toCsv(report.rows), "utf8");
    await writeFile(join(scenarioDir, "top-risers.csv"), toCsv(report.top_movers), "utf8");
    await writeFile(join(scenarioDir, "top-fallers.csv"), toCsv(report.top_fallers), "utf8");
    await writeFile(join(scenarioDir, "rank-stability.csv"), toCsv(report.rank_stability), "utf8");
    await writeFile(join(scenarioDir, "archetype-concentration.csv"), toCsv(report.concentration), "utf8");
    await writeFile(join(scenarioDir, "band-confusion-matrix.csv"), toCsv(report.confusion_matrix), "utf8");
    await writeFile(join(scenarioDir, "gold-set.seed.csv"), toCsv(buildGoldSetSeed(report.rows, report.thresholds, parsed.goldSetSize)), "utf8");

    indexRows.push({
      scenario: scenarioName,
      family: scenario.family,
      macro_f1: report.macro_f1,
      top_overlap: report.top_overlap,
      score_100_count: report.score_100_count,
      good_min: report.thresholds.good_min,
      very_good_min: report.thresholds.very_good_min,
      exceptional_min: report.thresholds.exceptional_min,
    });
  }

  await writeFile(join(outDir, "scenario-index.csv"), toCsv(indexRows), "utf8");
  console.log(`Scoring calibration written to ${outDir}`);
}
