import Papa from "papaparse";
import type { Lead } from "../../shared/types.js";
import type { ContactTier, PrimaryOffer, ScoreBandThresholds, ScoreCalibrationScenario } from "./types.js";
import { computeLeadScoringContext } from "./context.js";
import { resolveScoreBand, simulateCommercialScoreV3 } from "./v3.js";

export type ScoreBandLabel = "normal" | "bueno" | "muy_bueno" | "excepcional";

export interface GoldSetRow {
  lead_id: string;
  expected_band: ScoreBandLabel;
  expected_contactability?: "contactable" | "no_contactable";
  expected_primary_offer?: PrimaryOffer;
}

export interface ScenarioLeadResult {
  lead_id: string;
  name: string;
  source: string;
  niche: string;
  baseline_score: number;
  scenario_score: number;
  delta: number;
  baseline_rank: number;
  scenario_rank: number;
  rank_delta: number;
  primary_offer: PrimaryOffer;
  contact_tier: ContactTier;
  contact_ready: boolean;
  business_urgency_signal: string;
  freshness_signal: string;
  gap_depth: number;
  commercial_breadth: number;
  business_quality_pts: number;
  accessibility_bonus: number;
  timing_bonus: number;
  score_band: ScoreBandLabel;
}

export interface RankStabilityRow {
  cohort: string;
  size: number;
  spearman: number;
  top20_overlap: number;
  avg_abs_rank_delta: number;
}

export interface ConfusionMatrixRow {
  expected_band: ScoreBandLabel;
  predicted_band: ScoreBandLabel;
  count: number;
}

export interface GoldSetSeedRow extends ScenarioLeadResult {
  seed_reason: string;
}

export interface CalibrationScenarioReport {
  scenario: string;
  family: ScoreCalibrationScenario["family"];
  thresholds: ScoreBandThresholds;
  macro_f1: number | null;
  top_overlap: number;
  score_100_count: number;
  top_movers: ScenarioLeadResult[];
  top_fallers: ScenarioLeadResult[];
  concentration: Array<{ source: string; niche: string; primary_offer: string; exceptional_count: number; total_count: number }>;
  rank_stability: RankStabilityRow[];
  confusion_matrix: ConfusionMatrixRow[];
  rows: ScenarioLeadResult[];
}

const SCORE_BAND_LABELS: ScoreBandLabel[] = ["normal", "bueno", "muy_bueno", "excepcional"];

function compareDesc(left: { score: number; name: string; id: string }, right: { score: number; name: string; id: string }): number {
  if (right.score !== left.score) return right.score - left.score;
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
}

function bandFromScore(score: number, thresholds: ScoreBandThresholds): ScoreBandLabel {
  return resolveScoreBand(score, thresholds);
}

function scoreBandF1(rows: Array<{ expected: ScoreBandLabel; predicted: ScoreBandLabel }>): number {
  const f1s: number[] = [];
  for (const label of SCORE_BAND_LABELS) {
    const tp = rows.filter((row) => row.expected === label && row.predicted === label).length;
    const fp = rows.filter((row) => row.expected !== label && row.predicted === label).length;
    const fn = rows.filter((row) => row.expected === label && row.predicted !== label).length;
    const precision = tp === 0 ? 0 : tp / (tp + fp);
    const recall = tp === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    f1s.push(f1);
  }
  return f1s.reduce((sum, value) => sum + value, 0) / f1s.length;
}

function deriveThresholds(
  goldSet: GoldSetRow[],
  scoreByLeadId: Map<string, number>,
  fallback: ScoreBandThresholds
): { thresholds: ScoreBandThresholds; macroF1: number | null } {
  if (goldSet.length === 0) return { thresholds: fallback, macroF1: null };

  let bestThresholds = fallback;
  let bestMacroF1 = -1;

  for (let goodMin = 20; goodMin <= 60; goodMin++) {
    for (let veryGoodMin = goodMin + 8; veryGoodMin <= 80; veryGoodMin++) {
      for (let exceptionalMin = veryGoodMin + 8; exceptionalMin <= 95; exceptionalMin++) {
        const thresholds: ScoreBandThresholds = {
          normal_max: goodMin - 1,
          good_min: goodMin,
          very_good_min: veryGoodMin,
          exceptional_min: exceptionalMin,
        };

        const labeledRows = goldSet
          .map((row) => {
            const score = scoreByLeadId.get(row.lead_id);
            if (score == null) return null;
            return {
              expected: row.expected_band,
              predicted: bandFromScore(score, thresholds),
            };
          })
          .filter((row): row is { expected: ScoreBandLabel; predicted: ScoreBandLabel } => row !== null);

        if (labeledRows.length === 0) continue;
        const macroF1 = scoreBandF1(labeledRows);
        if (macroF1 > bestMacroF1) {
          bestMacroF1 = macroF1;
          bestThresholds = thresholds;
        }
      }
    }
  }

  return { thresholds: bestThresholds, macroF1: bestMacroF1 >= 0 ? Number(bestMacroF1.toFixed(4)) : null };
}

function buildConfusionMatrix(goldSet: GoldSetRow[], scoreByLeadId: Map<string, number>, thresholds: ScoreBandThresholds): ConfusionMatrixRow[] {
  const rows: ConfusionMatrixRow[] = [];
  for (const expectedBand of SCORE_BAND_LABELS) {
    for (const predictedBand of SCORE_BAND_LABELS) {
      let count = 0;
      for (const gold of goldSet) {
        const score = scoreByLeadId.get(gold.lead_id);
        if (score == null || gold.expected_band !== expectedBand) continue;
        if (bandFromScore(score, thresholds) === predictedBand) count += 1;
      }
      rows.push({ expected_band: expectedBand, predicted_band: predictedBand, count });
    }
  }
  return rows;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildRankStability(rows: ScenarioLeadResult[], cohort: string, predicate: (row: ScenarioLeadResult) => boolean): RankStabilityRow {
  const filtered = rows.filter(predicate);
  const n = filtered.length;
  if (n <= 1) {
    return { cohort, size: n, spearman: 1, top20_overlap: n, avg_abs_rank_delta: 0 };
  }

  const baselineOrdered = filtered.slice().sort((a, b) => a.baseline_rank - b.baseline_rank);
  const scenarioOrdered = filtered.slice().sort((a, b) => a.scenario_rank - b.scenario_rank);
  const baselineLocalRank = new Map(baselineOrdered.map((row, index) => [row.lead_id, index + 1]));
  const scenarioLocalRank = new Map(scenarioOrdered.map((row, index) => [row.lead_id, index + 1]));
  const sumSquared = filtered.reduce((sum, row) => {
    const baselineRank = baselineLocalRank.get(row.lead_id) ?? 0;
    const scenarioRank = scenarioLocalRank.get(row.lead_id) ?? 0;
    return sum + (baselineRank - scenarioRank) ** 2;
  }, 0);
  const spearman = 1 - (6 * sumSquared) / (n * (n * n - 1));
  const limit = Math.min(20, n);
  const baselineTop = new Set(baselineOrdered.slice(0, limit).map((row) => row.lead_id));
  const scenarioTop = new Set(scenarioOrdered.slice(0, limit).map((row) => row.lead_id));
  const overlap = [...baselineTop].filter((leadId) => scenarioTop.has(leadId)).length;
  const avgAbsRankDelta = filtered.reduce((sum, row) => {
    const baselineRank = baselineLocalRank.get(row.lead_id) ?? 0;
    const scenarioRank = scenarioLocalRank.get(row.lead_id) ?? 0;
    return sum + Math.abs(baselineRank - scenarioRank);
  }, 0) / n;

  return {
    cohort,
    size: n,
    spearman: round(spearman),
    top20_overlap: overlap,
    avg_abs_rank_delta: round(avgAbsRankDelta),
  };
}

function buildConcentration(rows: ScenarioLeadResult[]): CalibrationScenarioReport["concentration"] {
  const map = new Map<string, { source: string; niche: string; primary_offer: string; exceptional_count: number; total_count: number }>();
  for (const row of rows) {
    const key = `${row.source}::${row.niche}::${row.primary_offer}`;
    const current = map.get(key) ?? {
      source: row.source,
      niche: row.niche,
      primary_offer: row.primary_offer,
      exceptional_count: 0,
      total_count: 0,
    };
    current.total_count += 1;
    if (row.score_band === "excepcional") current.exceptional_count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.exceptional_count - a.exceptional_count || b.total_count - a.total_count).slice(0, 100);
}

export function parseGoldSetCsv(text: string): GoldSetRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return (parsed.data ?? [])
    .map((row) => {
      const leadId = (row.lead_id ?? "").trim();
      const expectedBand = (row.expected_band ?? "normal").trim() as ScoreBandLabel;
      const expectedContactability = (row.expected_contactability ?? "").trim();
      const expectedPrimaryOffer = (row.expected_primary_offer ?? "").trim();
      const parsedRow: GoldSetRow = {
        lead_id: leadId,
        expected_band: expectedBand,
      };
      if (expectedContactability) {
        parsedRow.expected_contactability = expectedContactability as "contactable" | "no_contactable";
      }
      if (expectedPrimaryOffer) {
        parsedRow.expected_primary_offer = expectedPrimaryOffer as PrimaryOffer;
      }
      return parsedRow;
    })
    .filter((row) => row.lead_id.length > 0 && SCORE_BAND_LABELS.includes(row.expected_band));
}

function takeSeedRows(
  rows: ScenarioLeadResult[],
  seed: GoldSetSeedRow[],
  seen: Set<string>,
  reason: string,
  limit: number,
  predicate: (row: ScenarioLeadResult) => boolean,
): void {
  for (const row of rows) {
    if (seed.length >= limit) break;
    if (seen.has(row.lead_id) || !predicate(row)) continue;
    seed.push({ ...row, seed_reason: reason });
    seen.add(row.lead_id);
  }
}

export function buildGoldSetSeed(
  rows: ScenarioLeadResult[],
  thresholds: ScoreBandThresholds,
  size = 80,
): GoldSetSeedRow[] {
  const seed: GoldSetSeedRow[] = [];
  const seen = new Set<string>();
  const sortedHigh = [...rows].sort((a, b) => b.scenario_score - a.scenario_score || a.scenario_rank - b.scenario_rank);
  const sortedLow = [...rows].sort((a, b) => a.scenario_score - b.scenario_score || a.scenario_rank - b.scenario_rank);
  const borderline = [...rows].sort((a, b) => Math.abs(a.scenario_score - thresholds.very_good_min) - Math.abs(b.scenario_score - thresholds.very_good_min));

  const targets: Array<[string, number, (row: ScenarioLeadResult) => boolean, ScenarioLeadResult[]]> = [
    [
      "restaurant_catalogo_extreme",
      10,
      (row) => row.niche === "restaurant" && row.primary_offer === "catalogo" && row.scenario_score >= thresholds.exceptional_min,
      sortedHigh,
    ],
    [
      "restaurant_catalogo_mid",
      10,
      (row) => row.niche === "restaurant" && row.primary_offer === "catalogo" && row.scenario_score >= thresholds.very_good_min && row.scenario_score < thresholds.exceptional_min,
      sortedHigh,
    ],
    [
      "web_nuevo_strong",
      10,
      (row) => row.primary_offer === "web_nuevo" && ["A", "B"].includes(row.contact_tier) && row.scenario_score >= thresholds.very_good_min,
      sortedHigh,
    ],
    [
      "software_strong",
      10,
      (row) => row.primary_offer === "software" && ["A", "B", "C"].includes(row.contact_tier) && row.scenario_score >= thresholds.very_good_min,
      sortedHigh,
    ],
    [
      "mixed_vertical_catalogo",
      10,
      (row) => ["car_dealer", "accommodation", "gym"].includes(row.niche) && row.primary_offer === "catalogo",
      sortedHigh,
    ],
    [
      "other_mintur_catalogo",
      10,
      (row) => row.source === "mintur" && row.niche === "other" && row.primary_offer === "catalogo",
      sortedHigh,
    ],
    [
      "borderline_good_very_good",
      10,
      (row) => Math.abs(row.scenario_score - thresholds.very_good_min) <= 3,
      borderline,
    ],
    [
      "weak_contact_false_positive",
      10,
      (row) => (!["A", "B", "C"].includes(row.contact_tier) || !row.contact_ready) && row.scenario_score >= thresholds.good_min,
      sortedHigh,
    ],
  ];

  for (const [reason, target, predicate, sourceRows] of targets) {
    takeSeedRows(sourceRows, seed, seen, reason, Math.min(size, seed.length + target), predicate);
  }

  if (seed.length < size) {
    takeSeedRows(sortedHigh, seed, seen, "top_fill", size, () => true);
  }
  if (seed.length < size) {
    takeSeedRows(borderline, seed, seen, "borderline_fill", size, () => true);
  }
  if (seed.length < size) {
    takeSeedRows(sortedLow, seed, seen, "low_fill", size, () => true);
  }

  return seed.slice(0, size);
}

export function buildCalibrationScenarioReport(
  leads: Lead[],
  scenarioName: string,
  scenario: ScoreCalibrationScenario,
  goldSet: GoldSetRow[] = []
): CalibrationScenarioReport {
  const contexts = leads.map((lead) => ({ lead, context: computeLeadScoringContext(lead), baseline: lead.prospect_score ?? 0 }));
  const baselineRanked = [...contexts].sort((left, right) => compareDesc({ score: left.baseline, name: left.lead.name, id: left.lead.id }, { score: right.baseline, name: right.lead.name, id: right.lead.id }));
  const scenarioRanked = [...contexts]
    .map(({ lead, context, baseline }) => ({
      lead,
      context,
      baseline,
      scenario: simulateCommercialScoreV3(lead, scenario, scenario.preview_thresholds, context),
    }))
    .sort((left, right) => compareDesc({ score: left.scenario.prospect_score, name: left.lead.name, id: left.lead.id }, { score: right.scenario.prospect_score, name: right.lead.name, id: right.lead.id }));

  const baselineRanks = new Map(baselineRanked.map((item, index) => [item.lead.id, index + 1]));
  const scenarioRanks = new Map(scenarioRanked.map((item, index) => [item.lead.id, index + 1]));
  const scoreByLeadId = new Map(scenarioRanked.map((item) => [item.lead.id, item.scenario.prospect_score]));
  const previewThresholds = scenario.preview_thresholds ?? { normal_max: 34, good_min: 35, very_good_min: 55, exceptional_min: 75 };
  const { thresholds, macroF1 } = deriveThresholds(goldSet, scoreByLeadId, previewThresholds);

  const rows: ScenarioLeadResult[] = scenarioRanked.map((item) => ({
    lead_id: item.lead.id,
    name: item.lead.name,
    source: item.lead.source,
    niche: item.lead.niche ?? "other",
    baseline_score: item.baseline,
    scenario_score: item.scenario.prospect_score,
    delta: item.scenario.prospect_score - item.baseline,
    baseline_rank: baselineRanks.get(item.lead.id) ?? 0,
    scenario_rank: scenarioRanks.get(item.lead.id) ?? 0,
    rank_delta: (baselineRanks.get(item.lead.id) ?? 0) - (scenarioRanks.get(item.lead.id) ?? 0),
    primary_offer: item.scenario.primary_offer,
    contact_tier: item.scenario.contact_tier,
    contact_ready: item.scenario.contact_ready,
    business_urgency_signal: item.scenario.business_urgency_signal,
    freshness_signal: item.scenario.freshness_signal,
    gap_depth: item.scenario.gap_depth,
    commercial_breadth: item.scenario.commercial_breadth,
    business_quality_pts: item.scenario.business_quality_pts,
    accessibility_bonus: item.scenario.accessibility_bonus,
    timing_bonus: item.scenario.timing_bonus,
    score_band: bandFromScore(item.scenario.prospect_score, thresholds),
  }));

  const topBaseline = new Set(baselineRanked.slice(0, 50).map((item) => item.lead.id));
  const topScenario = new Set(scenarioRanked.slice(0, 50).map((item) => item.lead.id));
  const topOverlap = [...topBaseline].filter((leadId) => topScenario.has(leadId)).length;

  return {
    scenario: scenarioName,
    family: scenario.family,
    thresholds,
    macro_f1: macroF1,
    top_overlap: topOverlap,
    score_100_count: rows.filter((row) => row.scenario_score === 100).length,
    top_movers: [...rows].sort((a, b) => b.delta - a.delta).slice(0, 50),
    top_fallers: [...rows].sort((a, b) => a.delta - b.delta).slice(0, 50),
    concentration: buildConcentration(rows),
    rank_stability: [
      buildRankStability(rows, "web_nuevo_ab", (row) => row.primary_offer === "web_nuevo" && ["A", "B"].includes(row.contact_tier)),
      buildRankStability(rows, "software_contactable", (row) => row.primary_offer === "software" && ["A", "B", "C"].includes(row.contact_tier)),
      buildRankStability(rows, "rediseno_strong", (row) => row.primary_offer === "rediseno" && ["A", "B", "C"].includes(row.contact_tier)),
    ],
    confusion_matrix: buildConfusionMatrix(goldSet, scoreByLeadId, thresholds),
    rows,
  };
}

export function toCsv(rows: object[]): string {
  return Papa.unparse(rows);
}
