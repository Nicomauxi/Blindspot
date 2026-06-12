import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCorroboratingSource, insertExternalLead } from "../../src/storage/external-leads.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../../src/shared/types.js";

const supabaseRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => supabaseRef.current),
}));

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    source: "mintur",
    external_id: "42",
    source_confidence: 0.8,
    name: "Hotel Ejemplo",
    address: "Av. Principal 123, Montevideo",
    phone: "099123456",
    website: null,
    email: null,
    latitude: null,
    longitude: null,
    niche: "tourism",
    raw: { _id: 42, Operador: "Hotel Ejemplo" },
    ...overrides,
  };
}

function leadRow(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "google_places:gp-1",
    source: "google_places",
    external_id: "gp-1",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: 0.45,
    contact_reliability_score: 0.1,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "tourism",
    name: "Hotel Ejemplo",
    address: "Av. Principal 123, Montevideo",
    rating: 4.5,
    review_count: 32,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    inferred_state: null,
    gps: null,
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
    ...overrides,
  };
}

describe("insertExternalLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without calling Supabase when dryRun is true", async () => {
    const fromFn = vi.fn();
    supabaseRef.current = { from: fromFn };

    const result = await insertExternalLead(candidate(), { dryRun: true });

    expect(result).toBeNull();
    expect(fromFn).not.toHaveBeenCalled();
  });

  it("upserts with place_id = 'mintur:42' and returns the lead", async () => {
    const returnedLead = { id: "lead-1", place_id: "mintur:42", name: "Hotel Ejemplo" };
    const singleFn = vi.fn(async () => ({ data: returnedLead, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: singleFn })),
      })),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    const result = await insertExternalLead(candidate());

    expect(result).toEqual(returnedLead);
    expect(upsertTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ place_id: "mintur:42", source: "mintur", external_id: "42" }),
      expect.objectContaining({ onConflict: "place_id" })
    );
  });

  it("uses niche 'other' when candidate.niche is null", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const singleFn = vi.fn(async () => ({ data: { id: "lead-2" }, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return { select: vi.fn(() => ({ single: singleFn })) };
      }),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await insertExternalLead(candidate({ niche: null }));

    expect(capturedPayload?.niche).toBe("other");
  });

  it("popula canonical_fields.email cuando candidate.email está presente", async () => {
    const returnedLead = { id: "lead-1", place_id: "mintur:42", name: "Hotel Ejemplo", canonical_fields: null };
    const singleFn = vi.fn(async () => ({ data: returnedLead, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: singleFn })),
      })),
    };
    let updatePayload: Record<string, unknown> | null = null;
    const updateEqFn = vi.fn(async () => ({ error: null }));
    const updateFn = vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload;
      return { eq: updateEqFn };
    });
    const leadsUpdateTable = { update: updateFn };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(upsertTable) // lookup place_id
        .mockReturnValueOnce(upsertTable) // upsert
        .mockReturnValueOnce(leadsUpdateTable),
    };

    await insertExternalLead(candidate({ email: "hotel@ejemplo.com" }));

    expect(updateFn).toHaveBeenCalledOnce();
    // N33: shape canónico {value,...}, no string plano (invisible para la capa SQL).
    expect((updatePayload?.canonical_fields as Record<string, unknown>)?.["email"]).toEqual({
      value: "hotel@ejemplo.com",
      confidence: 0.8,
      sources: ["mintur"],
      conflict: false,
    });
    expect(updateEqFn).toHaveBeenCalledWith("id", "lead-1");
  });

  it("omite UPDATE de canonical_fields cuando candidate.email es null", async () => {
    const returnedLead = { id: "lead-1", place_id: "mintur:42", name: "Hotel Ejemplo", canonical_fields: null };
    const singleFn = vi.fn(async () => ({ data: returnedLead, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: singleFn })),
      })),
    };
    const fromFn = vi.fn().mockReturnValue(upsertTable);
    supabaseRef.current = { from: fromFn };

    await insertExternalLead(candidate({ email: null }));

    expect(fromFn).toHaveBeenCalledTimes(2); // lookup + upsert (sin update de email)
  });

  it("propagates DB error", async () => {
    const singleFn = vi.fn(async () => ({ data: null, error: { message: "db error" } }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: singleFn })),
      })),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await expect(insertExternalLead(candidate())).rejects.toThrow("insertExternalLead failed: db error");
  });

  it("persiste gps como SRID=4326;POINT(lng lat) cuando el candidato tiene coordenadas", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const singleFn = vi.fn(async () => ({ data: { id: "lead-gps" }, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return { select: vi.fn(() => ({ single: singleFn })) };
      }),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await insertExternalLead(candidate({ latitude: -34.9011, longitude: -56.1645 }));

    expect(capturedPayload?.gps).toBe("SRID=4326;POINT(-56.1645 -34.9011)");
  });

  it("omite gps cuando el candidato no tiene coordenadas", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const singleFn = vi.fn(async () => ({ data: { id: "lead-nogps" }, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return { select: vi.fn(() => ({ single: singleFn })) };
      }),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await insertExternalLead(candidate({ latitude: null, longitude: null }));

    expect(capturedPayload).not.toHaveProperty("gps");
  });

  it("pasa extraTags al upsert cuando se proporcionan", async () => {
    let capturedPayload: Record<string, unknown> | null = null;
    const singleFn = vi.fn(async () => ({ data: { id: "lead-3" }, error: null }));
    const upsertTable = {
      // N3.1: lookup previo por place_id → no existe
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return { select: vi.fn(() => ({ single: singleFn })) };
      }),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await insertExternalLead(candidate(), { extraTags: ["franchise-detected"] });

    expect(capturedPayload?.tags).toEqual(["franchise-detected"]);
  });
});

describe("addCorroboratingSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call Supabase when dryRun is true", async () => {
    const fromFn = vi.fn();
    const rpcFn = vi.fn();
    supabaseRef.current = { from: fromFn, rpc: rpcFn };

    const result = await addCorroboratingSource("lead-1", candidate(), { dryRun: true });

    expect(fromFn).not.toHaveBeenCalled();
    expect(rpcFn).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("merges corroborating source, canonical fields and refreshed scores through the RPC", async () => {
    const currentLead = leadRow();
    const singleFn = vi.fn(async () => ({ data: currentLead, error: null }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };
    const returnedLead = leadRow({
      data_confidence_score: 0.7,
      contact_reliability_score: 0.2,
      canonical_fields: {
        email: {
          value: "hotel@ejemplo.com",
          confidence: 0.8,
          sources: ["mintur"],
          conflict: false,
        },
      },
      corroborating_sources: [
        {
          source: "mintur",
          external_id: "42",
          seen_at: "2026-01-01T00:00:00.000Z",
          confidence: 0.8,
        },
      ] as CorroboratingSource[],
    });
    const rpcSingleFn = vi.fn(async () => ({ data: returnedLead, error: null }));
    const rpcFn = vi.fn(() => ({ single: rpcSingleFn }));

    supabaseRef.current = {
      from: vi.fn(() => leadsTable),
      rpc: rpcFn,
    };

    const result = await addCorroboratingSource("lead-1", candidate({ email: "hotel@ejemplo.com" }));

    expect(rpcFn).toHaveBeenCalledWith(
      "merge_corroborating_source",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_source: "mintur",
        p_external_id: "42",
        p_source_confidence: 0.8,
        p_data_confidence_score: expect.any(Number),
        p_contact_reliability_score: expect.any(Number),
      })
    );

    const params = rpcFn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params.p_corroborating_sources).toEqual([
      expect.objectContaining({ source: "mintur", external_id: "42", confidence: 0.8 }),
    ]);
    expect(params.p_canonical_fields).toEqual({
      phone: {
        value: "099123456",
        confidence: 0.8,
        sources: ["mintur"],
        conflict: false,
      },
      email: {
        value: "hotel@ejemplo.com",
        confidence: 0.8,
        sources: ["mintur"],
        conflict: false,
      },
      // address corrobora entre la fuente del lead (google_places) y la corroborante (mintur)
      address: {
        value: "Av. Principal 123, Montevideo",
        confidence: 0.95,
        sources: ["google_places", "mintur"],
        conflict: false,
      },
    });
    expect(result).toEqual(returnedLead);
  });

  it("skips UPDATE when source already present in corroborating_sources (idempotent)", async () => {
    const rpcFn = vi.fn();
    const singleFn = vi.fn(async () => ({
      data: leadRow({
        corroborating_sources: [
          { source: "mintur", external_id: "42", seen_at: "2026-01-01T00:00:00.000Z", confidence: 0.8 },
        ],
      }),
      error: null,
    }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };

    supabaseRef.current = {
      from: vi.fn(() => leadsTable),
      rpc: rpcFn,
    };

    const result = await addCorroboratingSource("lead-1", candidate());

    expect(rpcFn).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        corroborating_sources: [
          expect.objectContaining({ source: "mintur", external_id: "42" }),
        ],
      })
    );
  });

  it("completa gps del lead primario cuando no tenía y la fuente corroborante trae coordenadas", async () => {
    const currentLead = leadRow({ gps: null });
    const fetchSingleFn = vi.fn(async () => ({ data: currentLead, error: null }));
    const leadsSelectTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: fetchSingleFn })) })),
    };
    const rpcSingleFn = vi.fn(async () => ({ data: leadRow({ gps: null }), error: null }));
    const rpcFn = vi.fn(() => ({ single: rpcSingleFn }));

    let gpsUpdatePayload: Record<string, unknown> | null = null;
    const gpsUpdateEqFn = vi.fn(async () => ({ error: null }));
    const gpsUpdateTable = {
      update: vi.fn((payload: Record<string, unknown>) => {
        gpsUpdatePayload = payload;
        return { eq: gpsUpdateEqFn };
      }),
    };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(leadsSelectTable)
        .mockReturnValueOnce(gpsUpdateTable),
      rpc: rpcFn,
    };

    const result = await addCorroboratingSource(
      "lead-1",
      candidate({ source: "osm", latitude: -34.9011, longitude: -56.1645 })
    );

    expect(gpsUpdatePayload?.gps).toBe("SRID=4326;POINT(-56.1645 -34.9011)");
    expect(gpsUpdateEqFn).toHaveBeenCalledWith("id", "lead-1");
    expect(result?.gps).toBe("SRID=4326;POINT(-56.1645 -34.9011)");
  });

  it("propagates error when lead fetch fails", async () => {
    const singleFn = vi.fn(async () => ({ data: null, error: { message: "fetch error" } }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };
    supabaseRef.current = {
      from: vi.fn(() => leadsTable),
      rpc: vi.fn(),
    };

    await expect(addCorroboratingSource("lead-1", candidate())).rejects.toThrow(
      "addCorroboratingSource lead fetch failed: fetch error"
    );
  });

  it("propagates error when the merge RPC fails", async () => {
    const singleFn = vi.fn(async () => ({ data: leadRow(), error: null }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };
    const rpcSingleFn = vi.fn(async () => ({ data: null, error: { message: "rpc error" } }));

    supabaseRef.current = {
      from: vi.fn(() => leadsTable),
      rpc: vi.fn(() => ({ single: rpcSingleFn })),
    };

    await expect(addCorroboratingSource("lead-1", candidate())).rejects.toThrow(
      "addCorroboratingSource update failed: rpc error"
    );
  });
});

describe("insertExternalLead — re-descubrimiento (N3.1/N16)", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockWithExisting(existing: Partial<Lead>) {
    const updates: Array<Record<string, unknown>> = [];
    const row = leadRow(existing);
    const table = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error: null })),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { ...row, ...payload }, error: null })),
            })),
          })),
        };
      }),
      upsert: vi.fn(),
    };
    supabaseRef.current = { from: vi.fn(() => table) };
    return { table, updates };
  }

  it("NO pisa tags/state/niche/passed_filter de un lead existente", async () => {
    const { table, updates } = mockWithExisting({
      place_id: "mintur:42",
      source: "mintur",
      tags: ["possible-duplicate", "duplicate-secondary", "landline-phone"],
      state: "enriched" as Lead["state"],
      niche: "bakery",
      passed_filter: false,
      rejection_reasons: ["duplicate-secondary"],
    });

    await insertExternalLead(candidate());

    expect(table.upsert).not.toHaveBeenCalled();
    const payload = updates[0]!;
    expect(payload).not.toHaveProperty("tags");
    expect(payload).not.toHaveProperty("state");
    expect(payload).not.toHaveProperty("niche");
    expect(payload).not.toHaveProperty("passed_filter");
    expect(payload["source_data"]).toBeDefined();
    expect(payload["name"]).toBe("Hotel Ejemplo");
  });

  it("rescata false→true cuando ahora corrobora y tiene contacto (N17 one-way)", async () => {
    const { updates } = mockWithExisting({
      place_id: "mintur:42",
      source: "mintur",
      passed_filter: false,
      rejection_reasons: ["no-contact"],
      corroborating_sources: [
        { source: "google_places", external_id: "x", seen_at: "2026-01-01", confidence: 0.9 },
      ],
      phone: "29151777",
    });

    await insertExternalLead(candidate({ phone: "29151777" }));

    const payload = updates[0]!;
    expect(payload["passed_filter"]).toBe(true);
    expect(payload["rejection_reasons"]).toEqual([]);
  });

  it("NO resucita un duplicate-secondary aunque califique", async () => {
    const { updates } = mockWithExisting({
      place_id: "mintur:42",
      source: "mintur",
      passed_filter: false,
      rejection_reasons: ["duplicate-secondary"],
      phone: "29151777",
    });

    await insertExternalLead(candidate({ phone: "29151777" }));

    expect(updates[0]).not.toHaveProperty("passed_filter");
  });
});

describe("addCorroboratingSource — rescue de passed_filter (N3.2/N17)", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(existing: Partial<Lead>) {
    const row = leadRow(existing);
    const rescueUpdates: Array<Record<string, unknown>> = [];
    const leadsTable = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: row, error: null })) })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        rescueUpdates.push(payload);
        return { eq: vi.fn(async () => ({ error: null })) };
      }),
    };
    const merged = { ...row, canonical_fields: { phone: { value: "099123456", confidence: 0.8, sources: ["mintur"], conflict: false } } };
    const rpcFn = vi.fn(() => ({ single: vi.fn(async () => ({ data: merged, error: null })) }));
    supabaseRef.current = { from: vi.fn(() => leadsTable), rpc: rpcFn };
    return { rescueUpdates };
  }

  it("un rejected 'no-contact' que corrobora con contacto mergeado vuelve al pool", async () => {
    const { rescueUpdates } = setup({
      passed_filter: false,
      rejection_reasons: ["no-contact"],
      phone: null,
      corroborating_sources: [],
    });

    await addCorroboratingSource("lead-1", candidate({ phone: "099123456" }));

    const rescue = rescueUpdates.find((u) => u["passed_filter"] === true);
    expect(rescue).toBeDefined();
    expect(rescue!["rejection_reasons"]).toEqual([]);
  });

  it("NO rescata un duplicate-secondary", async () => {
    const { rescueUpdates } = setup({
      passed_filter: false,
      rejection_reasons: ["duplicate-secondary"],
      corroborating_sources: [],
    });

    await addCorroboratingSource("lead-1", candidate({ phone: "099123456" }));

    expect(rescueUpdates.find((u) => u["passed_filter"] === true)).toBeUndefined();
  });
});
