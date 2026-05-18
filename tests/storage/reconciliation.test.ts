import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import { reconcileLeadIntoPrimary } from "../../src/storage/reconciliation.js";

const supabaseRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => supabaseRef.current),
}));

function leadRow(overrides: Partial<Lead> & { id: string; source: Lead["source"]; name: string }): Lead {
  return {
    id: overrides.id,
    place_id: `${overrides.source}:${overrides.id}`,
    source: overrides.source,
    external_id: overrides.external_id ?? overrides.id,
    source_confidence: overrides.source_confidence ?? 0.8,
    source_data: overrides.source_data ?? { foo: "bar" },
    data_confidence_score: overrides.data_confidence_score ?? 0.5,
    contact_reliability_score: overrides.contact_reliability_score ?? 0.2,
    canonical_fields: overrides.canonical_fields ?? null,
    corroborating_sources: overrides.corroborating_sources ?? [],
    canonical_source: overrides.canonical_source ?? null,
    lead_company_data: overrides.lead_company_data ?? null,
    niche: overrides.niche ?? "tourism",
    name: overrides.name,
    address: overrides.address ?? "Av. Principal 123, Montevideo",
    rating: overrides.rating ?? null,
    review_count: overrides.review_count ?? null,
    website: overrides.website ?? null,
    whatsapp: overrides.whatsapp ?? null,
    phone: overrides.phone ?? null,
    business_status: overrides.business_status ?? null,
    tags: overrides.tags ?? [],
    notes: overrides.notes ?? null,
    state: overrides.state ?? "discovered",
    first_seen_run_id: overrides.first_seen_run_id ?? null,
    last_seen_run_id: overrides.last_seen_run_id ?? null,
    google_data: overrides.google_data ?? null,
    digital_footprint: overrides.digital_footprint ?? null,
    inferred_state: overrides.inferred_state ?? null,
    gps: overrides.gps ?? null,
    reviews_sample: overrides.reviews_sample ?? null,
    business_quality_score: overrides.business_quality_score ?? null,
    digital_gap_score: overrides.digital_gap_score ?? null,
    systems_gap_score: overrides.systems_gap_score ?? null,
    prospect_score: overrides.prospect_score ?? null,
    passed_filter: overrides.passed_filter ?? true,
    rejection_reasons: overrides.rejection_reasons ?? [],
    score_breakdown: overrides.score_breakdown ?? null,
    systems_gap_breakdown: overrides.systems_gap_breakdown ?? null,
    contacted_at: overrides.contacted_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-02T00:00:00.000Z",
  };
}

describe("reconcileLeadIntoPrimary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves source refs/evidences into the primary lead and deletes the secondary", async () => {
    const primary = leadRow({
      id: "lead-primary",
      source: "google_places",
      name: "Hotel Bahia",
      prospect_score: 80,
      phone: "099123456",
    });
    const secondary = leadRow({
      id: "lead-secondary",
      source: "mintur",
      name: "Hotel Bahía",
      prospect_score: 10,
      phone: "099123456",
      canonical_fields: {
        email: {
          value: "reservas@bahia.com",
          confidence: 0.8,
          sources: ["mintur"],
          conflict: false,
        },
      },
      corroborating_sources: [
        {
          source: "yelu",
          external_id: "yl-1",
          seen_at: "2026-01-03T00:00:00.000Z",
          confidence: 0.7,
        },
      ],
    });

    const leadsSelect = vi.fn()
      .mockResolvedValueOnce({ data: primary, error: null })
      .mockResolvedValueOnce({ data: secondary, error: null })
      .mockResolvedValueOnce({
        data: {
          ...primary,
          canonical_fields: {
            email: {
              value: "reservas@bahia.com",
              confidence: 0.8,
              sources: ["mintur"],
              conflict: false,
            },
          },
          corroborating_sources: [
            { source: "mintur", external_id: "lead-secondary", seen_at: "2026-01-02T00:00:00.000Z", confidence: 0.8 },
            { source: "yelu", external_id: "yl-1", seen_at: "2026-01-03T00:00:00.000Z", confidence: 0.7 },
          ],
        },
        error: null,
      });

    const sourceRefsSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            lead_id: "lead-secondary",
            source: "yelu",
            external_id: "yl-1",
            source_confidence: 0.7,
            raw_data: { source: "yelu" },
            seen_at: "2026-01-03T00:00:00.000Z",
          },
        ],
        error: null,
      });

    const evidenceSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            lead_id: "lead-secondary",
            field_name: "email",
            value: "reservas@bahia.com",
            sources: ["mintur"],
            confidence: 0.8,
            first_seen: "2026-01-01",
            last_seen: "2026-01-02",
          },
        ],
        error: null,
      });

    const leadsEq = vi.fn(() => ({ single: leadsSelect }));
    const refsEq = vi.fn(() => sourceRefsSelect());
    const evidenceEq = vi.fn(() => evidenceSelect());

    const leadsTable = {
      select: vi.fn(() => ({ eq: leadsEq })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    };
    const refsTable = {
      select: vi.fn(() => ({ eq: refsEq })),
      upsert: vi.fn(async () => ({ error: null })),
    };
    const evidenceTable = {
      select: vi.fn(() => ({ eq: evidenceEq })),
      upsert: vi.fn(async () => ({ error: null })),
    };

    const fromFn = vi.fn((table: string) => {
      if (table === "leads") return leadsTable;
      if (table === "lead_source_references") return refsTable;
      if (table === "lead_field_evidences") return evidenceTable;
      throw new Error(`Unexpected table ${table}`);
    });

    supabaseRef.current = { from: fromFn };

    const result = await reconcileLeadIntoPrimary("lead-primary", "lead-secondary");

    expect(refsTable.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ lead_id: "lead-primary", source: "mintur" }),
        expect.objectContaining({ lead_id: "lead-primary", source: "yelu" }),
      ]),
      expect.objectContaining({ onConflict: "lead_id,source" })
    );
    expect(evidenceTable.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lead_id: "lead-primary",
          field_name: "email",
          value: "reservas@bahia.com",
        }),
      ]),
      expect.objectContaining({ onConflict: "lead_id,field_name,value" })
    );
    expect(leadsTable.delete).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "lead-primary",
        corroborating_sources: expect.arrayContaining([
          expect.objectContaining({ source: "mintur" }),
          expect.objectContaining({ source: "yelu" }),
        ]),
      })
    );
  });

  it("sets canonical_source to primary source when it has the highest confidence", async () => {
    const primary = leadRow({
      id: "lead-p2",
      source: "google_places",
      name: "Restaurante Central",
      source_confidence: 0.9,
    });
    const secondary = leadRow({
      id: "lead-s2",
      source: "mintur",
      name: "Rest. Central",
      source_confidence: 0.7,
    });

    const finalLead = { ...primary, corroborating_sources: [{ source: "mintur", seen_at: "2026-01-02T00:00:00.000Z", confidence: 0.7 }], canonical_source: "google_places" };

    const leadsSelect = vi.fn()
      .mockResolvedValueOnce({ data: primary, error: null })
      .mockResolvedValueOnce({ data: secondary, error: null })
      .mockResolvedValueOnce({ data: finalLead, error: null });
    const sourceRefsSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const evidenceSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: leadsSelect })) })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    };
    const refsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => sourceRefsSelect()) })),
      upsert: vi.fn(async () => ({ error: null })),
    };
    const evidenceTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => evidenceSelect()) })),
      upsert: vi.fn(async () => ({ error: null })),
    };

    supabaseRef.current = {
      from: vi.fn((table: string) => {
        if (table === "leads") return leadsTable;
        if (table === "lead_source_references") return refsTable;
        if (table === "lead_field_evidences") return evidenceTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await reconcileLeadIntoPrimary("lead-p2", "lead-s2");

    const updateCall = leadsTable.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall).toMatchObject({ canonical_source: "google_places" });
  });

  it("sets canonical_source to corroborating source when it has higher confidence than primary", async () => {
    const primary = leadRow({
      id: "lead-p3",
      source: "google_places",
      name: "Gym Zona Norte",
      source_confidence: 0.6,
    });
    const secondary = leadRow({
      id: "lead-s3",
      source: "mintur",
      name: "Gym Zona Norte MINTUR",
      source_confidence: 0.9,
    });

    const finalLead = { ...primary, corroborating_sources: [{ source: "mintur", seen_at: "2026-01-02T00:00:00.000Z", confidence: 0.9 }], canonical_source: "mintur" };

    const leadsSelect = vi.fn()
      .mockResolvedValueOnce({ data: primary, error: null })
      .mockResolvedValueOnce({ data: secondary, error: null })
      .mockResolvedValueOnce({ data: finalLead, error: null });
    const sourceRefsSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const evidenceSelect = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: leadsSelect })) })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    };
    const refsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => sourceRefsSelect()) })),
      upsert: vi.fn(async () => ({ error: null })),
    };
    const evidenceTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => evidenceSelect()) })),
      upsert: vi.fn(async () => ({ error: null })),
    };

    supabaseRef.current = {
      from: vi.fn((table: string) => {
        if (table === "leads") return leadsTable;
        if (table === "lead_source_references") return refsTable;
        if (table === "lead_field_evidences") return evidenceTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    await reconcileLeadIntoPrimary("lead-p3", "lead-s3");

    const updateCall = leadsTable.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall).toMatchObject({ canonical_source: "mintur" });
  });
});
