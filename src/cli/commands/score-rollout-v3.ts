import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getScoringCalibrationConfig } from "../../modules/scoring/calibration-config.js";
import { buildScoreResultV3, simulateCommercialScoreV3 } from "../../modules/scoring/v3.js";
import { toCsv } from "../../modules/scoring/simulate.js";
import { computeAllBuyerScores } from "../../modules/scoring/buyer-types.js";
import { loadLeadsByScoringVersion, updateLeadScore, upsertBuyerScores } from "../../storage/leads.js";
import { createLeadScoreSnapshots } from "../../storage/lead-score-snapshots.js";
import { getAdminServicePricing } from "../../storage/service-pricing.js";

const ArgsSchema = z.object({
  scenario: z.string(),
  snapshotLabel: z.string().optional(),
  outputDir: z.string().optional(),
  fromVersion: z.coerce.number().int().min(1).default(2),
  dryRun: z.coerce.boolean().default(false),
});

interface RawArgs {
  scenario: string;
  snapshotLabel?: string;
  outputDir?: string;
  fromVersion?: number;
  dryRun?: boolean;
}

function defaultSnapshotLabel(name: string): string {
  return `pre_${name}_${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`;
}

export async function scoreRolloutV3Command(rawArgs: RawArgs): Promise<void> {
  const args = ArgsSchema.parse(rawArgs);
  const calibration = getScoringCalibrationConfig();
  const scenario = calibration.scenarios[args.scenario];
  if (!scenario) throw new Error(`Unknown calibration scenario: ${args.scenario}`);

  const leads = await loadLeadsByScoringVersion(args.fromVersion);
  if (leads.length === 0) throw new Error(`No leads found for scoring_version=${args.fromVersion}`);

  const snapshotLabel = args.snapshotLabel ?? defaultSnapshotLabel(args.scenario);
  const outputDir = args.outputDir ?? join("reports", "score-rollout-v3", snapshotLabel);
  await mkdir(outputDir, { recursive: true });

  const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
  const buyerScoreOpts = deliverySystemCostUyu != null ? { deliverySystemCostUyu } : {};
  const movers: Array<Record<string, string | number | boolean | null>> = [];

  if (!args.dryRun) {
    await createLeadScoreSnapshots(snapshotLabel, leads);
  }

  for (const lead of leads) {
    const before = lead.prospect_score ?? 0;
    const result = buildScoreResultV3(lead, scenario);
    const breakdown = simulateCommercialScoreV3(lead, scenario);
    const leadWithScore = {
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
    const buyerScores = computeAllBuyerScores(leadWithScore, buyerScoreOpts);

    movers.push({
      lead_id: lead.id,
      name: lead.name,
      source: lead.source,
      niche: lead.niche ?? "other",
      before_score: before,
      after_score: result.prospect_score,
      delta: result.prospect_score - before,
      primary_offer: breakdown.primary_offer,
      contact_tier: breakdown.contact_tier,
      contact_ready: result.contact_ready,
      score_band: breakdown.score_band,
    });

    if (!args.dryRun) {
      await updateLeadScore(lead.id, result);
      await upsertBuyerScores(lead.id, buyerScores);
    }
  }

  const sortedRisers = [...movers].sort((a, b) => Number(b.delta) - Number(a.delta));
  const sortedFallers = [...movers].sort((a, b) => Number(a.delta) - Number(b.delta));
  await writeFile(join(outputDir, "top-risers.csv"), toCsv(sortedRisers.slice(0, 50)), "utf8");
  await writeFile(join(outputDir, "top-fallers.csv"), toCsv(sortedFallers.slice(0, 50)), "utf8");
  await writeFile(join(outputDir, "all-movers.csv"), toCsv(movers), "utf8");
  await writeFile(join(outputDir, "manual-review-sample.csv"), toCsv([...sortedRisers.slice(0, 20), ...sortedFallers.slice(0, 20)]), "utf8");
  console.log(`${args.dryRun ? "Dry-run" : "Rollout"} v3 complete for ${leads.length} leads from scoring_version=${args.fromVersion}. Output: ${outputDir}`);
}
