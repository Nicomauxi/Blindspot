import type { Lead } from "../../shared/types.js";
import { CONTACTABLE_TIERS, getCanonicalPhone, getEmailCount } from "./contact.js";
import { scoreLeadV1 } from "./index.js";
import { getScoringCalibrationConfig } from "./calibration-config.js";
import { computeLeadScoringContext } from "./context.js";
import { simulateCommercialScoreV3 } from "./v3.js";
import type { ScoreBandThresholds, ScoreCalibrationScenario } from "./types.js";

const DEFAULT_THRESHOLDS: ScoreBandThresholds = {
  normal_max: 34,
  good_min: 35,
  very_good_min: 55,
  exceptional_min: 75,
};

/** v3 clamps prospect_score to [0, 99]; "saturated" = pinned at this ceiling. */
const SCORE_CEILING = 99;

interface ActiveScenario {
  scenario: ScoreCalibrationScenario;
  thresholds: ScoreBandThresholds;
}

/**
 * FS-12a: the eval harness must score the candidate column with the SAME model
 * production ranks with (commercial_score_v3) under the active calibration
 * scenario, and read the hot/pitcheable thresholds from that scenario instead
 * of hardcoding 55/40. Otherwise the gold-set/criteria validate a phantom model.
 */
function resolveActiveScenario(): ActiveScenario {
  const calibration = getScoringCalibrationConfig();
  const scenario = calibration.scenarios[calibration.default_scenario];
  if (!scenario) {
    throw new Error(`Missing default calibration scenario: ${calibration.default_scenario}`);
  }
  return { scenario, thresholds: scenario.preview_thresholds ?? DEFAULT_THRESHOLDS };
}

export type ContactTier = "A" | "B" | "C" | "D" | "X";
export type EvalPrimaryOffer =
  | "web_nuevo"
  | "rediseno"
  | "marketing"
  | "software"
  | "catalogo"
  | "contacto_directo"
  | "none";
export type ExpectedDirection = "rise" | "fall" | "stable";
export type GoldSetContactability = "contactable" | "incontactable";

export interface EvalSubScores {
  web_nuevo: number;
  rediseno: number;
  marketing: number;
  software: number;
  catalogo: number;
  contacto_directo: number;
}

export interface EvalV3Breakdown {
  subScores: EvalSubScores;
  primaryOffer: EvalPrimaryOffer;
  sourceQualityBonus: number;
  contactTier: ContactTier;
  pitchHook: string;
  gapDepth: number;
  commercialBreadth: number;
  businessQualityPts: number;
  dataConfidence: number;
  contactReliability: number;
  contactReady: boolean;
}

export interface LeadScoreComparison {
  leadId: string;
  placeId: string;
  name: string;
  source: string;
  niche: string;
  v1Score: number;
  v3Score: number;
  delta: number;
  v1Rank: number;
  v3Rank: number;
  rankDelta: number;
  v3ContactTier: ContactTier;
  v3PrimaryOffer: EvalPrimaryOffer;
  v3PitchHook: string;
  v3ContactReady: boolean;
  isFranchise: boolean;
  dataConfidence: number;
  contactReliability: number;
  corroboratingSources: number;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  hasEmail: boolean;
  reasonSummary: string;
}

export interface DistributionRow {
  bucket: string;
  count: number;
  avgV1: number;
  avgV3: number;
  avgDelta: number;
  hotV1: number;
  hotV3: number;
  pitcheableV1: number;
  pitcheableV3: number;
}

export interface CriterionStatus {
  status: "pass" | "warn";
  count?: number;
  avgV3?: number;
  percent?: number;
  threshold: string;
}

export interface ScoreEvalCriteria {
  tierXHot: CriterionStatus;
  cappedAt100: CriterionStatus;
  franchiseAverage: CriterionStatus;
  carDealerContactableAverage: CriterionStatus;
}

export interface GoldSetSeedRow {
  leadId: string;
  name: string;
  source: string;
  niche: string;
  v1Score: number;
  v3Score: number;
  delta: number;
  expectedDirection: ExpectedDirection;
  expectedContactability: GoldSetContactability;
  expectedFranchise: boolean;
  expectedPrimaryOffer: EvalPrimaryOffer;
  selectionBucket: string;
  selectionReason: string;
  reviewStatus: "pending_human";
}

export interface ScoreEvalReport {
  meta: {
    generatedAt: string;
    poolSize: number;
    topCount: number;
    goldSetSize: number;
  };
  criteria: ScoreEvalCriteria;
  bySource: DistributionRow[];
  byNiche: DistributionRow[];
  byContactTier: DistributionRow[];
  topV1: LeadScoreComparison[];
  topV3: LeadScoreComparison[];
  topComparison: LeadScoreComparison[];
  biggestRisers: LeadScoreComparison[];
  biggestFallers: LeadScoreComparison[];
  goldSetSeed: GoldSetSeedRow[];
  topOverlapCount: number;
  comparisons: LeadScoreComparison[];
}

interface BuildScoreEvalOptions {
  topCount?: number;
  goldSetSize?: number;
  generatedAt?: string;
}

interface V3Simulation {
  score: number;
  breakdown: EvalV3Breakdown;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function compareScoresDesc(
  a: { score: number; name: string; id: string },
  b: { score: number; name: string; id: string }
): number {
  if (b.score !== a.score) return b.score - a.score;
  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;
  return a.id.localeCompare(b.id);
}

function buildDistribution(
  comparisons: LeadScoreComparison[],
  keyFn: (item: LeadScoreComparison) => string,
  thresholds: ScoreBandThresholds
): DistributionRow[] {
  const map = new Map<string, LeadScoreComparison[]>();
  const hot = thresholds.very_good_min;
  const pitcheable = thresholds.good_min;

  for (const item of comparisons) {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }

  return Array.from(map.entries())
    .map(([bucket, items]) => {
      const count = items.length;
      const sumV1 = items.reduce((sum, item) => sum + item.v1Score, 0);
      const sumV3 = items.reduce((sum, item) => sum + item.v3Score, 0);
      return {
        bucket,
        count,
        avgV1: round1(sumV1 / count),
        avgV3: round1(sumV3 / count),
        avgDelta: round1((sumV3 - sumV1) / count),
        hotV1: items.filter((item) => item.v1Score >= hot).length,
        hotV3: items.filter((item) => item.v3Score >= hot).length,
        pitcheableV1: items.filter((item) => item.v1Score >= pitcheable).length,
        pitcheableV3: items.filter((item) => item.v3Score >= pitcheable).length,
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.bucket.localeCompare(b.bucket);
    });
}

function computeExpectedDirection(delta: number): ExpectedDirection {
  if (delta >= 8) return "rise";
  if (delta <= -8) return "fall";
  return "stable";
}

function computeReasonSummary(
  lead: Lead,
  breakdown: EvalV3Breakdown,
  v1Score: number,
  v3Score: number
): string {
  const parts: string[] = [];
  const delta = v3Score - v1Score;

  if (breakdown.contactTier === "X") parts.push("tier X clamps accessibility");
  if (lead.tags.includes("franchise-detected")) parts.push("franchise penalty");
  if (breakdown.sourceQualityBonus > 0) parts.push(`source bonus +${breakdown.sourceQualityBonus}`);
  if (breakdown.subScores.contacto_directo > 0) parts.push("direct-contact path activated");
  if (breakdown.commercialBreadth > 0) parts.push(`breadth +${breakdown.commercialBreadth}`);
  if (breakdown.businessQualityPts >= 10) parts.push(`business quality ${breakdown.businessQualityPts}/15`);
  if (breakdown.contactTier === "A") parts.push("email tier A");
  if (breakdown.contactReady) parts.push("contact ready");
  if (delta >= 20) parts.push("large upward reprioritization");
  if (delta <= -20) parts.push("large downward reprioritization");

  return parts.slice(0, 4).join("; ") || "score moved without a dominant single factor";
}

function simulateV3Score(
  lead: Lead,
  scenario: ScoreCalibrationScenario,
  thresholds: ScoreBandThresholds
): V3Simulation {
  // FS-12a: same model production ranks with. Reuse the production context so
  // data_confidence/contact_reliability match exactly what v3 computed.
  const context = computeLeadScoringContext(lead);
  const snapshot = simulateCommercialScoreV3(lead, scenario, thresholds, context);
  const adjusted = snapshot.sub_scores_adjusted;

  return {
    score: snapshot.prospect_score,
    breakdown: {
      subScores: {
        web_nuevo: adjusted.web_nuevo,
        rediseno: adjusted.rediseno,
        marketing: adjusted.marketing,
        software: adjusted.software,
        catalogo: adjusted.catalogo,
        contacto_directo: adjusted.contacto_directo,
      },
      primaryOffer: snapshot.primary_offer,
      sourceQualityBonus: snapshot.source_quality_bonus,
      contactTier: snapshot.contact_tier,
      pitchHook: snapshot.pitch_hook,
      gapDepth: snapshot.gap_depth,
      commercialBreadth: snapshot.commercial_breadth,
      businessQualityPts: snapshot.business_quality_pts,
      dataConfidence: context.data_confidence,
      contactReliability: context.contact_reliability,
      contactReady: snapshot.contact_ready,
    },
  };
}

function selectGoldSetSeed(
  comparisons: LeadScoreComparison[],
  size: number
): GoldSetSeedRow[] {
  const selected = new Map<string, GoldSetSeedRow>();

  const buckets: Array<{ label: string; limit: number; items: LeadScoreComparison[] }> = [
    {
      label: "tier-x-collapse",
      limit: 10,
      items: comparisons
        .filter((item) => item.v3ContactTier === "X" && item.v1Score >= 55)
        .sort((left, right) => left.delta - right.delta),
    },
    {
      label: "franchise-penalty",
      limit: 8,
      items: comparisons
        .filter((item) => item.isFranchise)
        .sort((left, right) => left.delta - right.delta),
    },
    {
      label: "car-dealer-rise",
      limit: 6,
      items: comparisons
        .filter((item) => item.niche === "car_dealer" && CONTACTABLE_TIERS.has(item.v3ContactTier))
        .sort((left, right) => right.delta - left.delta),
    },
    {
      label: "mintur-direct-contact",
      limit: 8,
      items: comparisons
        .filter((item) => item.source === "mintur" && item.v3PrimaryOffer === "contacto_directo")
        .sort((left, right) => right.v3Score - left.v3Score),
    },
    {
      label: "top-v3-control",
      limit: Math.max(8, Math.floor(size / 4)),
      items: [...comparisons].sort((left, right) => right.v3Score - left.v3Score),
    },
  ];

  for (const bucket of buckets) {
    for (const item of bucket.items) {
      if (selected.size >= size) break;
      if (selected.has(item.leadId)) continue;
      if (
        Array.from(selected.values()).filter((row) => row.selectionBucket === bucket.label).length >= bucket.limit
      ) {
        break;
      }

      selected.set(item.leadId, {
        leadId: item.leadId,
        name: item.name,
        source: item.source,
        niche: item.niche,
        v1Score: item.v1Score,
        v3Score: item.v3Score,
        delta: item.delta,
        expectedDirection: computeExpectedDirection(item.delta),
        expectedContactability: CONTACTABLE_TIERS.has(item.v3ContactTier) ? "contactable" : "incontactable",
        expectedFranchise: item.isFranchise,
        expectedPrimaryOffer: item.v3PrimaryOffer,
        selectionBucket: bucket.label,
        selectionReason: item.reasonSummary,
        reviewStatus: "pending_human",
      });
    }
  }

  if (selected.size < size) {
    for (const item of comparisons) {
      if (selected.size >= size) break;
      if (selected.has(item.leadId)) continue;
      selected.set(item.leadId, {
        leadId: item.leadId,
        name: item.name,
        source: item.source,
        niche: item.niche,
        v1Score: item.v1Score,
        v3Score: item.v3Score,
        delta: item.delta,
        expectedDirection: computeExpectedDirection(item.delta),
        expectedContactability: CONTACTABLE_TIERS.has(item.v3ContactTier) ? "contactable" : "incontactable",
        expectedFranchise: item.isFranchise,
        expectedPrimaryOffer: item.v3PrimaryOffer,
        selectionBucket: "fill",
        selectionReason: item.reasonSummary,
        reviewStatus: "pending_human",
      });
    }
  }

  return Array.from(selected.values());
}

export function buildScoreEvalReport(
  leads: Lead[],
  opts: BuildScoreEvalOptions = {}
): ScoreEvalReport {
  const topCount = opts.topCount ?? 50;
  const goldSetSize = opts.goldSetSize ?? 40;
  const { scenario, thresholds } = resolveActiveScenario();

  const enriched = leads.map((lead) => {
    const v1Score = lead.prospect_score_v1 ?? lead.prospect_score ?? scoreLeadV1(lead).prospect_score;
    const simulation = simulateV3Score(lead, scenario, thresholds);
    return { lead, v1Score, v3: simulation };
  });

  const v1Ranked = [...enriched]
    .sort((left, right) => compareScoresDesc(
      { score: left.v1Score, name: left.lead.name, id: left.lead.id },
      { score: right.v1Score, name: right.lead.name, id: right.lead.id }
    ));
  const v3Ranked = [...enriched]
    .sort((left, right) => compareScoresDesc(
      { score: left.v3.score, name: left.lead.name, id: left.lead.id },
      { score: right.v3.score, name: right.lead.name, id: right.lead.id }
    ));

  const v1Ranks = new Map(v1Ranked.map((item, index) => [item.lead.id, index + 1]));
  const v3Ranks = new Map(v3Ranked.map((item, index) => [item.lead.id, index + 1]));

  const comparisons: LeadScoreComparison[] = enriched
    .map(({ lead, v1Score, v3 }) => {
      const v1Rank = v1Ranks.get(lead.id) ?? 0;
      const v3Rank = v3Ranks.get(lead.id) ?? 0;
      return {
        leadId: lead.id,
        placeId: lead.place_id,
        name: lead.name,
        source: lead.source,
        niche: lead.niche ?? "other",
        v1Score,
        v3Score: v3.score,
        delta: v3.score - v1Score,
        v1Rank,
        v3Rank,
        rankDelta: v1Rank - v3Rank,
        v3ContactTier: v3.breakdown.contactTier,
        v3PrimaryOffer: v3.breakdown.primaryOffer,
        v3PitchHook: v3.breakdown.pitchHook,
        v3ContactReady: v3.breakdown.contactReady,
        isFranchise: lead.tags.includes("franchise-detected"),
        dataConfidence: v3.breakdown.dataConfidence,
        contactReliability: v3.breakdown.contactReliability,
        corroboratingSources: lead.corroborating_sources.length,
        address: lead.address,
        phone: lead.phone ?? getCanonicalPhone(lead),
        whatsapp: lead.whatsapp,
        hasEmail: getEmailCount(lead) > 0,
        reasonSummary: computeReasonSummary(lead, v3.breakdown, v1Score, v3.score),
      };
    })
    .sort((left, right) => compareScoresDesc(
      { score: left.v3Score, name: left.name, id: left.leadId },
      { score: right.v3Score, name: right.name, id: right.leadId }
    ));

  const topV1Ids = new Set(v1Ranked.slice(0, topCount).map((item) => item.lead.id));
  const topV3Ids = new Set(v3Ranked.slice(0, topCount).map((item) => item.lead.id));
  const topOverlapCount = Array.from(topV1Ids).filter((leadId) => topV3Ids.has(leadId)).length;

  const topV1 = comparisons
    .filter((item) => item.v1Rank <= topCount)
    .sort((left, right) => left.v1Rank - right.v1Rank);
  const topV3 = comparisons
    .filter((item) => item.v3Rank <= topCount)
    .sort((left, right) => left.v3Rank - right.v3Rank);
  const topComparison = comparisons
    .filter((item) => item.v1Rank <= topCount || item.v3Rank <= topCount)
    .sort((left, right) => Math.min(left.v1Rank, left.v3Rank) - Math.min(right.v1Rank, right.v3Rank));

  const biggestRisers = [...comparisons]
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 25);
  const biggestFallers = [...comparisons]
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 25);

  const tierXHotCount = comparisons.filter((item) => item.v3ContactTier === "X" && item.v3Score >= thresholds.very_good_min).length;
  const saturatedCount = comparisons.filter((item) => item.v3Score >= SCORE_CEILING).length;
  const saturatedPct = comparisons.length === 0 ? 0 : round1((saturatedCount / comparisons.length) * 100);

  const franchiseRows = comparisons.filter((item) => item.isFranchise);
  const franchiseAvg = franchiseRows.length === 0
    ? 0
    : round1(franchiseRows.reduce((sum, item) => sum + item.v3Score, 0) / franchiseRows.length);

  const carDealerContactableRows = comparisons.filter(
    (item) => item.niche === "car_dealer" && CONTACTABLE_TIERS.has(item.v3ContactTier)
  );
  const carDealerContactableAvg = carDealerContactableRows.length === 0
    ? 0
    : round1(carDealerContactableRows.reduce((sum, item) => sum + item.v3Score, 0) / carDealerContactableRows.length);

  return {
    meta: {
      generatedAt: opts.generatedAt ?? new Date().toISOString(),
      poolSize: comparisons.length,
      topCount,
      goldSetSize,
    },
    criteria: {
      tierXHot: {
        status: tierXHotCount < 5 ? "pass" : "warn",
        count: tierXHotCount,
        threshold: `tier X && score < ${thresholds.very_good_min}; target < 5 leads`,
      },
      cappedAt100: {
        status: saturatedPct < 5 ? "pass" : "warn",
        count: saturatedCount,
        percent: saturatedPct,
        threshold: `score >= ${SCORE_CEILING}; < 5% of active pool`,
      },
      franchiseAverage: {
        status: franchiseAvg < 20 ? "pass" : "warn",
        avgV3: franchiseAvg,
        threshold: "< 20 avg",
      },
      carDealerContactableAverage: {
        status: carDealerContactableAvg > 40 ? "pass" : "warn",
        avgV3: carDealerContactableAvg,
        threshold: "> 40 avg",
      },
    },
    bySource: buildDistribution(comparisons, (item) => item.source, thresholds),
    byNiche: buildDistribution(comparisons, (item) => item.niche, thresholds),
    byContactTier: buildDistribution(comparisons, (item) => item.v3ContactTier, thresholds),
    topV1,
    topV3,
    topComparison,
    biggestRisers,
    biggestFallers,
    goldSetSeed: selectGoldSetSeed(comparisons, goldSetSize),
    topOverlapCount,
    comparisons,
  };
}
