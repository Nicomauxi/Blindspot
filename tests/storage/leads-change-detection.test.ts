import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyerTypeScore, ScoreResult } from "../../src/modules/scoring/types.js";
import type { DigitalFootprint, Lead } from "../../src/shared/types.js";

const { mockFrom, mockScoreLead, mockComputeAllBuyerScores, mockGetAdminServicePricing } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockScoreLead: vi.fn(),
  mockComputeAllBuyerScores: vi.fn(),
  mockGetAdminServicePricing: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("../../src/modules/scoring/index.js", () => ({
  scoreLead: mockScoreLead,
}));

vi.mock("../../src/modules/scoring/buyer-types.js", () => ({
  computeAllBuyerScores: mockComputeAllBuyerScores,
}));

vi.mock("../../src/storage/service-pricing.js", () => ({
  getAdminServicePricing: mockGetAdminServicePricing,
}));

import { updateLeadEnrichment } from "../../src/storage/leads.js";

function makeUpdatedLead(): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    source: "google_places",
    external_id: "place-1",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: 0.8,
    contact_reliability_score: 0.6,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "restaurant",
    name: "Cafe Sur",
    address: null,
    rating: 4.5,
    review_count: 35,
    website: "https://cafe.example.com",
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: "run-1",
    last_seen_run_id: "run-1",
    google_data: null,
    digital_footprint: null,
    inferred_state: null,
    gps: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: 40,
    scoring_version: 2,
    contact_ready: false,
    prospect_score_v1: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: { contact_tier: "C" },
    score_breakdown_v1: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-18T00:00:00Z",
  };
}

function makeScoreResult(): ScoreResult {
  return {
    business_quality_score: 50,
    digital_gap_score: 30,
    systems_gap_score: 15,
    prospect_score: 61,
    scoring_version: 2,
    contact_ready: true,
    systems_gap_breakdown: { total: 15, rules: [] },
    score_breakdown: {
      computed_at: "2026-05-18T00:00:00Z",
      config_version: 2,
      business_quality: { total: 50, rules: [] },
      digital_gap: { total: 30, rules: [] },
      systems_gap: { total: 15, rules: [] },
      prospect: { formula: "commercial_score_v2", total: 61 },
      sub_scores: {
        web_nuevo: 20,
        rediseno: 0,
        marketing: 0,
        software: 0,
        catalogo: 0,
        contacto_directo: 0,
        primary_offer: "web_nuevo",
      },
      primary_offer: "web_nuevo",
      source_quality_bonus: 0,
      contact_tier: "A",
      pitch_hook: "Nueva web disponible",
      urgency_signal: "medium",
      gap_depth: 20,
      commercial_breadth: 0,
      business_quality_pts: 10,
      accessibility_factor: 1.3,
      timing_factor: 1,
      urgency_bonus: 0,
      inferred_state_summary: {
        has_delivery: true,
        has_pos: false,
        has_reservations: false,
        has_ecommerce: false,
        digitalization_level: "basic",
      },
    },
  };
}

describe("updateLeadEnrichment change detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminServicePricing.mockResolvedValue(3000);
    mockScoreLead.mockReturnValue(makeScoreResult());
    mockComputeAllBuyerScores.mockReturnValue([
      {
        buyer_type: "delivery_propio",
        score: 70,
        breakdown: { rationale: "has delivery" },
      },
    ] satisfies BuyerTypeScore[]);
  });

  it("persists last_change_diff and rescoring when a critical change appears", async () => {
    const currentLeadRow = {
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-05-01T00:00:00Z",
        contact_emails: [],
      },
      tags: ["profile:a", "no-website"],
      whatsapp: null,
      phone: null,
      canonical_fields: null,
      score_breakdown: { contact_tier: "C" },
    };

    const firstLeadUpdateEq = vi.fn();
    const diffPersistEq = vi.fn().mockResolvedValue({ error: null });
    const scoreUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const buyerScoreUpsert = vi.fn().mockResolvedValue({ error: null });
    let diffPersistPayload: Record<string, unknown> | undefined;

    firstLeadUpdateEq.mockResolvedValue({
      data: {
        ...makeUpdatedLead(),
        digital_footprint: {
          fetched_at: "2026-05-18T00:00:00Z",
          final_url: "https://cafe.example.com",
          contact_emails: ["hola@cafe.example.com"],
          inferred_state: {
            has_reservations: { value: false, confidence: 0.2, via: [] },
            has_delivery: { value: true, confidence: 0.95, via: ["pedidosya"] },
            has_online_catalog: { value: false, confidence: 0.2, via: [] },
            has_ecommerce: { value: false, confidence: 0.2, via: [] },
            has_pos: { value: false, confidence: 0.2, via: [] },
            has_chat_support: { value: false, confidence: 0.2, via: [] },
            digitalization_level: "basic",
            computed_at: "2026-05-18T00:00:00Z",
          },
        },
      },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: currentLeadRow, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            if ("contact_reliability_score" in payload) {
              return {
                eq: () => ({
                  select: () => ({
                    single: firstLeadUpdateEq,
                  }),
                }),
              };
            }
            if ("prospect_score" in payload) {
              return { eq: scoreUpdateEq };
            }
            diffPersistPayload = payload;
            return { eq: diffPersistEq };
          },
        };
      }

      if (table === "lead_buyer_scores") {
        return { upsert: buyerScoreUpsert };
      }

      return {};
    });

    const result = await updateLeadEnrichment(
      "lead-1",
      {
        fetched_at: "2026-05-18T00:00:00Z",
        final_url: "https://cafe.example.com",
        contact_emails: ["hola@cafe.example.com"],
        inferred_state: {
          has_reservations: { value: false, confidence: 0.2, via: [] },
          has_delivery: { value: true, confidence: 0.95, via: ["pedidosya"] },
          has_online_catalog: { value: false, confidence: 0.2, via: [] },
          has_ecommerce: { value: false, confidence: 0.2, via: [] },
          has_pos: { value: false, confidence: 0.2, via: [] },
          has_chat_support: { value: false, confidence: 0.2, via: [] },
          digitalization_level: "basic",
          computed_at: "2026-05-18T00:00:00Z",
        },
      } satisfies DigitalFootprint,
      ["website-heuristic", "email-found"],
      null
    );

    expect(result.critical_change).toBe(true);
    expect(result.rescored).toBe(true);
    expect(mockScoreLead).toHaveBeenCalled();
    expect(scoreUpdateEq).toHaveBeenCalledWith("id", "lead-1");
    expect(buyerScoreUpsert).toHaveBeenCalled();
    expect(diffPersistEq).toHaveBeenCalledWith("id", "lead-1");

    expect((diffPersistPayload?.tags as string[] | undefined) ?? []).toContain("state-changed-significant");
    expect((diffPersistPayload?.digital_footprint as Record<string, unknown>).last_change_diff).toEqual(
      expect.objectContaining({
        lead_id: "lead-1",
        changes: expect.arrayContaining([
          expect.objectContaining({ field: "has_website" }),
          expect.objectContaining({ field: "contact_email" }),
          expect.objectContaining({ field: "inferred_state.has_delivery" }),
          expect.objectContaining({ field: "contact_tier", from: "C", to: "A" }),
        ]),
      })
    );
  });
});
