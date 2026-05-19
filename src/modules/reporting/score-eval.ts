import Papa from "papaparse";
import type {
  DistributionRow,
  GoldSetSeedRow,
  LeadScoreComparison,
  ScoreEvalReport,
} from "../scoring/eval.js";

export interface GeneratedScoreEvalArtifacts {
  summaryMd: string;
  summaryJson: string;
  leadDeltasCsv: string;
  topV1Csv: string;
  topV2Csv: string;
  topComparisonCsv: string;
  bySourceCsv: string;
  byNicheCsv: string;
  byContactTierCsv: string;
  goldSetCsv: string;
}

function renderStatus(status: "pass" | "warn"): string {
  return status === "pass" ? "PASS" : "WARN";
}

function renderDistributionTable(rows: DistributionRow[]): string {
  const lines = [
    "| Bucket | Count | Avg v1 | Avg v2 | Avg delta | Hot v1 | Hot v2 | Pitch v1 | Pitch v2 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.bucket} | ${row.count} | ${row.avgV1.toFixed(1)} | ${row.avgV2.toFixed(1)} | ${row.avgDelta.toFixed(1)} | ${row.hotV1} | ${row.hotV2} | ${row.pitcheableV1} | ${row.pitcheableV2} |`
    );
  }

  return lines.join("\n");
}

function trimRows(rows: LeadScoreComparison[], limit: number): LeadScoreComparison[] {
  return rows.slice(0, limit);
}

function renderTopTable(rows: LeadScoreComparison[]): string {
  const lines = [
    "| Name | Source | Niche | v1 | v2 | Delta | v1 rank | v2 rank | Tier | Offer | Reason |",
    "|---|---|---|---:|---:|---:|---:|---:|---|---|---|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.source} | ${row.niche} | ${row.v1Score} | ${row.v2Score} | ${row.delta} | ${row.v1Rank} | ${row.v2Rank} | ${row.v2ContactTier} | ${row.v2PrimaryOffer} | ${row.reasonSummary} |`
    );
  }

  return lines.join("\n");
}

function renderGoldSetTable(rows: GoldSetSeedRow[]): string {
  const lines = [
    "| Name | Source | Niche | v1 | v2 | Delta | Expected direction | Contactability | Franchise | Offer | Bucket | Review |",
    "|---|---|---|---:|---:|---:|---|---|---|---|---|---|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.source} | ${row.niche} | ${row.v1Score} | ${row.v2Score} | ${row.delta} | ${row.expectedDirection} | ${row.expectedContactability} | ${row.expectedFranchise ? "yes" : "no"} | ${row.expectedPrimaryOffer} | ${row.selectionBucket} | ${row.reviewStatus} |`
    );
  }

  return lines.join("\n");
}

function buildSummaryJson(report: ScoreEvalReport): string {
  return JSON.stringify(
    {
      meta: report.meta,
      criteria: report.criteria,
      topOverlapCount: report.topOverlapCount,
      bySource: report.bySource,
      byNiche: report.byNiche,
      byContactTier: report.byContactTier,
      topV1: report.topV1,
      topV2: report.topV2,
      topComparison: report.topComparison,
      biggestRisers: report.biggestRisers,
      biggestFallers: report.biggestFallers,
      goldSetSeed: report.goldSetSeed,
    },
    null,
    2
  );
}

function buildSummaryMd(report: ScoreEvalReport): string {
  return [
    "# Fase 22-eval",
    "",
    `Generated at: ${report.meta.generatedAt}`,
    `Pool size: ${report.meta.poolSize}`,
    `Top-N compared: ${report.meta.topCount}`,
    `Bootstrap gold set size: ${report.meta.goldSetSize}`,
    `Top-${report.meta.topCount} overlap: ${report.topOverlapCount}`,
    "",
    "## Gate checks",
    "",
    `- Tier X with v2 score >= 55: ${report.criteria.tierXHot.count} (${renderStatus(report.criteria.tierXHot.status)}; target ${report.criteria.tierXHot.threshold})`,
    `- Leads with v2 score = 100: ${report.criteria.cappedAt100.count} / ${report.meta.poolSize} = ${report.criteria.cappedAt100.percent?.toFixed(1)}% (${renderStatus(report.criteria.cappedAt100.status)}; target ${report.criteria.cappedAt100.threshold})`,
    `- Franchise average v2: ${report.criteria.franchiseAverage.avgV2?.toFixed(1)} (${renderStatus(report.criteria.franchiseAverage.status)}; target ${report.criteria.franchiseAverage.threshold})`,
    `- Contactable car_dealer average v2: ${report.criteria.carDealerContactableAverage.avgV2?.toFixed(1)} (${renderStatus(report.criteria.carDealerContactableAverage.status)}; target ${report.criteria.carDealerContactableAverage.threshold})`,
    "",
    "## Distribution by source",
    "",
    renderDistributionTable(report.bySource),
    "",
    "## Distribution by contact tier (v2)",
    "",
    renderDistributionTable(report.byContactTier),
    "",
    "## Top niche distribution (first 15 rows)",
    "",
    renderDistributionTable(report.byNiche.slice(0, 15)),
    "",
    `## Top ${report.meta.topCount} comparison`,
    "",
    renderTopTable(trimRows(report.topComparison, report.meta.topCount)),
    "",
    "## Biggest risers (> 20 is a review target)",
    "",
    renderTopTable(trimRows(report.biggestRisers, 15)),
    "",
    "## Biggest fallers (< -20 is a review target)",
    "",
    renderTopTable(trimRows(report.biggestFallers, 15)),
    "",
    "## Gold set seed (pending human review)",
    "",
    "This seed is machine-generated from the current snapshot so Nicolas can review, trim, or relabel it before Fase 22.",
    "",
    renderGoldSetTable(report.goldSetSeed),
    "",
  ].join("\n");
}

function csvForComparisons(rows: LeadScoreComparison[]): string {
  return Papa.unparse(rows);
}

function csvForDistribution(rows: DistributionRow[]): string {
  return Papa.unparse(rows);
}

function csvForGoldSet(rows: GoldSetSeedRow[]): string {
  return Papa.unparse(rows);
}

export function generateScoreEvalArtifacts(report: ScoreEvalReport): GeneratedScoreEvalArtifacts {
  return {
    summaryMd: buildSummaryMd(report),
    summaryJson: buildSummaryJson(report),
    leadDeltasCsv: csvForComparisons(report.comparisons),
    topV1Csv: csvForComparisons(report.topV1),
    topV2Csv: csvForComparisons(report.topV2),
    topComparisonCsv: csvForComparisons(report.topComparison),
    bySourceCsv: csvForDistribution(report.bySource),
    byNicheCsv: csvForDistribution(report.byNiche),
    byContactTierCsv: csvForDistribution(report.byContactTier),
    goldSetCsv: csvForGoldSet(report.goldSetSeed),
  };
}
