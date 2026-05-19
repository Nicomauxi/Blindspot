import type { Lead } from "../../shared/types.js";
import { computeContactTier, CONTACTABLE_TIERS, getCanonicalPhone, getEmailCount } from "./contact.js";
import { scoreLeadV1 } from "./index.js";
import { calculateSubScores } from "./sub-scores.js";
import { scoreSystemsGap } from "./systems-gap.js";
import { computeCommercialScore } from "./v2.js";

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

export interface EvalV2Breakdown {
  subScores: EvalSubScores;
  primaryOffer: EvalPrimaryOffer;
  sourceQualityBonus: number;
  contactTier: ContactTier;
  pitchHook: string;
  urgencySignal: "high" | "medium" | "low";
  gapDepth: number;
  commercialBreadth: number;
  businessQualityPts: number;
  accessibilityFactor: number;
  timingFactor: number;
  urgencyBonus: number;
  inferredStateSummary: {
    hasDelivery: boolean;
    hasPos: boolean;
    hasReservations: boolean;
    hasEcommerce: boolean;
    digitalizationLevel: string | null;
  };
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
  v2Score: number;
  delta: number;
  v1Rank: number;
  v2Rank: number;
  rankDelta: number;
  v2ContactTier: ContactTier;
  v2PrimaryOffer: EvalPrimaryOffer;
  v2PitchHook: string;
  v2ContactReady: boolean;
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
  avgV2: number;
  avgDelta: number;
  hotV1: number;
  hotV2: number;
  pitcheableV1: number;
  pitcheableV2: number;
}

export interface CriterionStatus {
  status: "pass" | "warn";
  count?: number;
  avgV2?: number;
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
  v2Score: number;
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
  topV2: LeadScoreComparison[];
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

interface V2Simulation {
  score: number;
  breakdown: EvalV2Breakdown;
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
  keyFn: (item: LeadScoreComparison) => string
): DistributionRow[] {
  const map = new Map<string, LeadScoreComparison[]>();

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
      const sumV2 = items.reduce((sum, item) => sum + item.v2Score, 0);
      return {
        bucket,
        count,
        avgV1: round1(sumV1 / count),
        avgV2: round1(sumV2 / count),
        avgDelta: round1((sumV2 - sumV1) / count),
        hotV1: items.filter((item) => item.v1Score >= 55).length,
        hotV2: items.filter((item) => item.v2Score >= 55).length,
        pitcheableV1: items.filter((item) => item.v1Score >= 40).length,
        pitcheableV2: items.filter((item) => item.v2Score >= 40).length,
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
  breakdown: EvalV2Breakdown,
  v1Score: number,
  v2Score: number
): string {
  const parts: string[] = [];
  const delta = v2Score - v1Score;

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

function simulateV2Score(lead: Lead): V2Simulation {
  const sgScore = scoreSystemsGap(lead).total;
  const subScores = calculateSubScores(lead, Math.floor(sgScore), {
    contactTier: computeContactTier(lead),
  });
  const commercial = computeCommercialScore(lead, subScores);

  return {
    score: commercial.prospect_score,
    breakdown: {
      subScores,
      primaryOffer: commercial.primary_offer,
      sourceQualityBonus: commercial.source_quality_bonus,
      contactTier: commercial.contact_tier,
      pitchHook: commercial.pitch_hook,
      urgencySignal: commercial.urgency_signal,
      gapDepth: commercial.gap_depth,
      commercialBreadth: commercial.commercial_breadth,
      businessQualityPts: commercial.business_quality_pts,
      accessibilityFactor: commercial.accessibility_factor,
      timingFactor: commercial.timing_factor,
      urgencyBonus: commercial.urgency_bonus,
      inferredStateSummary: {
        hasDelivery: commercial.inferred_state_summary.has_delivery,
        hasPos: commercial.inferred_state_summary.has_pos,
        hasReservations: commercial.inferred_state_summary.has_reservations,
        hasEcommerce: commercial.inferred_state_summary.has_ecommerce,
        digitalizationLevel: commercial.inferred_state_summary.digitalization_level,
      },
      dataConfidence: commercial.data_confidence,
      contactReliability: commercial.contact_reliability,
      contactReady: commercial.contact_ready,
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
        .filter((item) => item.v2ContactTier === "X" && item.v1Score >= 55)
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
        .filter((item) => item.niche === "car_dealer" && CONTACTABLE_TIERS.has(item.v2ContactTier))
        .sort((left, right) => right.delta - left.delta),
    },
    {
      label: "mintur-direct-contact",
      limit: 8,
      items: comparisons
        .filter((item) => item.source === "mintur" && item.v2PrimaryOffer === "contacto_directo")
        .sort((left, right) => right.v2Score - left.v2Score),
    },
    {
      label: "top-v2-control",
      limit: Math.max(8, Math.floor(size / 4)),
      items: [...comparisons].sort((left, right) => right.v2Score - left.v2Score),
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
        v2Score: item.v2Score,
        delta: item.delta,
        expectedDirection: computeExpectedDirection(item.delta),
        expectedContactability: CONTACTABLE_TIERS.has(item.v2ContactTier) ? "contactable" : "incontactable",
        expectedFranchise: item.isFranchise,
        expectedPrimaryOffer: item.v2PrimaryOffer,
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
        v2Score: item.v2Score,
        delta: item.delta,
        expectedDirection: computeExpectedDirection(item.delta),
        expectedContactability: CONTACTABLE_TIERS.has(item.v2ContactTier) ? "contactable" : "incontactable",
        expectedFranchise: item.isFranchise,
        expectedPrimaryOffer: item.v2PrimaryOffer,
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

  const enriched = leads.map((lead) => {
    const v1Score = lead.prospect_score_v1 ?? lead.prospect_score ?? scoreLeadV1(lead).prospect_score;
    const simulation = simulateV2Score(lead);
    return { lead, v1Score, v2: simulation };
  });

  const v1Ranked = [...enriched]
    .sort((left, right) => compareScoresDesc(
      { score: left.v1Score, name: left.lead.name, id: left.lead.id },
      { score: right.v1Score, name: right.lead.name, id: right.lead.id }
    ));
  const v2Ranked = [...enriched]
    .sort((left, right) => compareScoresDesc(
      { score: left.v2.score, name: left.lead.name, id: left.lead.id },
      { score: right.v2.score, name: right.lead.name, id: right.lead.id }
    ));

  const v1Ranks = new Map(v1Ranked.map((item, index) => [item.lead.id, index + 1]));
  const v2Ranks = new Map(v2Ranked.map((item, index) => [item.lead.id, index + 1]));

  const comparisons: LeadScoreComparison[] = enriched
    .map(({ lead, v1Score, v2 }) => {
      const v1Rank = v1Ranks.get(lead.id) ?? 0;
      const v2Rank = v2Ranks.get(lead.id) ?? 0;
      return {
        leadId: lead.id,
        placeId: lead.place_id,
        name: lead.name,
        source: lead.source,
        niche: lead.niche ?? "other",
        v1Score,
        v2Score: v2.score,
        delta: v2.score - v1Score,
        v1Rank,
        v2Rank,
        rankDelta: v1Rank - v2Rank,
        v2ContactTier: v2.breakdown.contactTier,
        v2PrimaryOffer: v2.breakdown.primaryOffer,
        v2PitchHook: v2.breakdown.pitchHook,
        v2ContactReady: v2.breakdown.contactReady,
        isFranchise: lead.tags.includes("franchise-detected"),
        dataConfidence: v2.breakdown.dataConfidence,
        contactReliability: v2.breakdown.contactReliability,
        corroboratingSources: lead.corroborating_sources.length,
        address: lead.address,
        phone: lead.phone ?? getCanonicalPhone(lead),
        whatsapp: lead.whatsapp,
        hasEmail: getEmailCount(lead) > 0,
        reasonSummary: computeReasonSummary(lead, v2.breakdown, v1Score, v2.score),
      };
    })
    .sort((left, right) => compareScoresDesc(
      { score: left.v2Score, name: left.name, id: left.leadId },
      { score: right.v2Score, name: right.name, id: right.leadId }
    ));

  const topV1Ids = new Set(v1Ranked.slice(0, topCount).map((item) => item.lead.id));
  const topV2Ids = new Set(v2Ranked.slice(0, topCount).map((item) => item.lead.id));
  const topOverlapCount = Array.from(topV1Ids).filter((leadId) => topV2Ids.has(leadId)).length;

  const topV1 = comparisons
    .filter((item) => item.v1Rank <= topCount)
    .sort((left, right) => left.v1Rank - right.v1Rank);
  const topV2 = comparisons
    .filter((item) => item.v2Rank <= topCount)
    .sort((left, right) => left.v2Rank - right.v2Rank);
  const topComparison = comparisons
    .filter((item) => item.v1Rank <= topCount || item.v2Rank <= topCount)
    .sort((left, right) => Math.min(left.v1Rank, left.v2Rank) - Math.min(right.v1Rank, right.v2Rank));

  const biggestRisers = [...comparisons]
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 25);
  const biggestFallers = [...comparisons]
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 25);

  const tierXHotCount = comparisons.filter((item) => item.v2ContactTier === "X" && item.v2Score >= 55).length;
  const score100Count = comparisons.filter((item) => item.v2Score === 100).length;
  const score100Pct = comparisons.length === 0 ? 0 : round1((score100Count / comparisons.length) * 100);

  const franchiseRows = comparisons.filter((item) => item.isFranchise);
  const franchiseAvg = franchiseRows.length === 0
    ? 0
    : round1(franchiseRows.reduce((sum, item) => sum + item.v2Score, 0) / franchiseRows.length);

  const carDealerContactableRows = comparisons.filter(
    (item) => item.niche === "car_dealer" && CONTACTABLE_TIERS.has(item.v2ContactTier)
  );
  const carDealerContactableAvg = carDealerContactableRows.length === 0
    ? 0
    : round1(carDealerContactableRows.reduce((sum, item) => sum + item.v2Score, 0) / carDealerContactableRows.length);

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
        threshold: "< 5 leads",
      },
      cappedAt100: {
        status: score100Pct < 5 ? "pass" : "warn",
        count: score100Count,
        percent: score100Pct,
        threshold: "< 5% of active pool",
      },
      franchiseAverage: {
        status: franchiseAvg < 20 ? "pass" : "warn",
        avgV2: franchiseAvg,
        threshold: "< 20 avg",
      },
      carDealerContactableAverage: {
        status: carDealerContactableAvg > 40 ? "pass" : "warn",
        avgV2: carDealerContactableAvg,
        threshold: "> 40 avg",
      },
    },
    bySource: buildDistribution(comparisons, (item) => item.source),
    byNiche: buildDistribution(comparisons, (item) => item.niche),
    byContactTier: buildDistribution(comparisons, (item) => item.v2ContactTier),
    topV1,
    topV2,
    topComparison,
    biggestRisers,
    biggestFallers,
    goldSetSeed: selectGoldSetSeed(comparisons, goldSetSize),
    topOverlapCount,
    comparisons,
  };
}
