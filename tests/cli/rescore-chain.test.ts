import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, Run } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadLeadsByIds: vi.fn(),
  updateLeadScore: vi.fn(),
  upsertBuyerScores: vi.fn(),
}));

vi.mock("../../src/storage/runs.js", () => ({
  createScoringRun: vi.fn(),
  completeScoringRun: vi.fn(),
  failRun: vi.fn(),
}));

vi.mock("../../src/modules/scoring/index.js", () => ({
  scoreLead: vi.fn(),
}));

vi.mock("../../src/modules/scoring/buyer-types.js", () => ({
  computeAllBuyerScores: vi.fn(),
}));

vi.mock("../../src/storage/service-pricing.js", () => ({
  getAdminServicePricing: vi.fn(),
}));

import { rescoreLeadsChained } from "../../src/cli/commands/rescore-chain.js";
import { loadLeadsByIds, updateLeadScore, upsertBuyerScores } from "../../src/storage/leads.js";
import { createScoringRun, completeScoringRun, failRun } from "../../src/storage/runs.js";
import { scoreLead } from "../../src/modules/scoring/index.js";
import { computeAllBuyerScores } from "../../src/modules/scoring/buyer-types.js";
import { getAdminServicePricing } from "../../src/storage/service-pricing.js";

const ENRICH_RUN = { id: "11111111-2222-3333-4444-555555555555", niche: "x", location: "y", profile: "a" } as unknown as Run;
const SCORING_RUN_ID = "99999999-8888-7777-6666-555555555555";

function makeLead(id: string): Lead {
  return {
    id,
    place_id: `place-${id}`,
    name: `Lead ${id}`,
    niche: "restaurante",
    address: null,
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: ENRICH_RUN.id,
    last_seen_run_id: ENRICH_RUN.id,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const scoreResult = {
  business_quality_score: 10,
  digital_gap_score: 20,
  systems_gap_score: 5,
  prospect_score: 42,
  scoring_version: 2,
  contact_ready: true,
  score_breakdown: {},
  systems_gap_breakdown: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createScoringRun).mockResolvedValue({ id: SCORING_RUN_ID } as never);
  vi.mocked(completeScoringRun).mockResolvedValue(undefined);
  vi.mocked(failRun).mockResolvedValue(undefined as never);
  vi.mocked(scoreLead).mockReturnValue(scoreResult as never);
  vi.mocked(computeAllBuyerScores).mockReturnValue([] as never);
  vi.mocked(updateLeadScore).mockResolvedValue(undefined as never);
  vi.mocked(upsertBuyerScores).mockResolvedValue(undefined as never);
  vi.mocked(getAdminServicePricing).mockResolvedValue(null);
});

describe("rescoreLeadsChained", () => {
  it("no hace nada con lista vacía de ids", async () => {
    const result = await rescoreLeadsChained(ENRICH_RUN, []);
    expect(result).toBeNull();
    expect(createScoringRun).not.toHaveBeenCalled();
  });

  it("crea run de scoring dependiente, re-score con el estado post-enrich y completa", async () => {
    vi.mocked(loadLeadsByIds).mockResolvedValue([makeLead("l1"), makeLead("l2")]);

    const result = await rescoreLeadsChained(ENRICH_RUN, ["l1", "l2"]);

    expect(createScoringRun).toHaveBeenCalledWith({ scope: "run", sourceRun: ENRICH_RUN, dryRun: false });
    expect(loadLeadsByIds).toHaveBeenCalledWith(["l1", "l2"]);
    expect(scoreLead).toHaveBeenCalledTimes(2);
    expect(updateLeadScore).toHaveBeenCalledWith("l1", scoreResult);
    expect(updateLeadScore).toHaveBeenCalledWith("l2", scoreResult);
    expect(upsertBuyerScores).toHaveBeenCalledTimes(2);
    expect(completeScoringRun).toHaveBeenCalledWith(
      SCORING_RUN_ID,
      expect.objectContaining({
        command: "score",
        scope: "run",
        source_run_id: ENRICH_RUN.id,
        leads_scored: 2,
      })
    );
    expect(result).toEqual({ runId: SCORING_RUN_ID, leadsScored: 2 });
  });

  it("marca el run como fallido y propaga el error si el scoring revienta", async () => {
    vi.mocked(loadLeadsByIds).mockResolvedValue([makeLead("l1")]);
    vi.mocked(updateLeadScore).mockRejectedValue(new Error("db caída"));

    await expect(rescoreLeadsChained(ENRICH_RUN, ["l1"])).rejects.toThrow("db caída");
    expect(failRun).toHaveBeenCalledWith(SCORING_RUN_ID, "db caída", expect.any(Number));
    expect(completeScoringRun).not.toHaveBeenCalled();
  });
});
