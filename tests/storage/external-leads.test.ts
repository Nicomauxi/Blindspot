import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCorroboratingSource, insertExternalLead } from "../../src/storage/external-leads.js";
import type { DiscoveryCandidate } from "../../src/shared/types.js";

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
      upsert: vi.fn((payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return { select: vi.fn(() => ({ single: singleFn })) };
      }),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await insertExternalLead(candidate({ niche: null }));

    expect(capturedPayload?.niche).toBe("other");
  });

  it("propagates DB error", async () => {
    const singleFn = vi.fn(async () => ({ data: null, error: { message: "db error" } }));
    const upsertTable = {
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: singleFn })),
      })),
    };
    supabaseRef.current = { from: vi.fn(() => upsertTable) };

    await expect(insertExternalLead(candidate())).rejects.toThrow("insertExternalLead failed: db error");
  });
});

describe("addCorroboratingSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call Supabase when dryRun is true", async () => {
    const fromFn = vi.fn();
    supabaseRef.current = { from: fromFn };

    await addCorroboratingSource("lead-1", candidate(), { dryRun: true });

    expect(fromFn).not.toHaveBeenCalled();
  });

  it("upserts into lead_source_references with onConflict lead_id,source", async () => {
    const refUpsertFn = vi.fn(async () => ({ error: null }));
    const refTable = { upsert: refUpsertFn };

    const existingSources = [{ source: "google_places", external_id: "gp-1", seen_at: "2026-01-01T00:00:00.000Z", confidence: 0.9 }];
    const singleFn = vi.fn(async () => ({
      data: { corroborating_sources: existingSources },
      error: null,
    }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(refTable)
        .mockReturnValueOnce(leadsTable)
        .mockReturnValueOnce(leadsTable),
    };

    await addCorroboratingSource("lead-1", candidate());

    expect(refUpsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: "lead-1", source: "mintur", external_id: "42" }),
      expect.objectContaining({ onConflict: "lead_id,source" })
    );
  });

  it("appends new CorroboratingSource when source not yet present", async () => {
    const refTable = { upsert: vi.fn(async () => ({ error: null })) };

    let updatePayload: Record<string, unknown> | null = null;
    const updateEqFn = vi.fn(async () => ({ error: null }));
    const updateFn = vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload;
      return { eq: updateEqFn };
    });

    const singleFn = vi.fn(async () => ({
      data: { corroborating_sources: [] },
      error: null,
    }));
    const leadsSelectTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };
    const leadsUpdateTable = { update: updateFn };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(refTable)
        .mockReturnValueOnce(leadsSelectTable)
        .mockReturnValueOnce(leadsUpdateTable),
    };

    await addCorroboratingSource("lead-1", candidate());

    expect(updatePayload?.corroborating_sources).toHaveLength(1);
    expect((updatePayload?.corroborating_sources as Array<{ source: string }>)[0]?.source).toBe("mintur");
    expect(updateEqFn).toHaveBeenCalledWith("id", "lead-1");
  });

  it("skips UPDATE when source already present in corroborating_sources (idempotent)", async () => {
    const refTable = { upsert: vi.fn(async () => ({ error: null })) };

    const updateFn = vi.fn();
    const singleFn = vi.fn(async () => ({
      data: {
        corroborating_sources: [
          { source: "mintur", external_id: "42", seen_at: "2026-01-01T00:00:00.000Z", confidence: 0.8 },
        ],
      },
      error: null,
    }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
      update: updateFn,
    };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(refTable)
        .mockReturnValueOnce(leadsTable),
    };

    await addCorroboratingSource("lead-1", candidate());

    expect(updateFn).not.toHaveBeenCalled();
  });

  it("propagates error when lead_source_references upsert fails", async () => {
    const refTable = { upsert: vi.fn(async () => ({ error: { message: "ref error" } })) };
    supabaseRef.current = { from: vi.fn(() => refTable) };

    await expect(addCorroboratingSource("lead-1", candidate())).rejects.toThrow(
      "addCorroboratingSource ref insert failed: ref error"
    );
  });

  it("propagates error when lead fetch fails", async () => {
    const refTable = { upsert: vi.fn(async () => ({ error: null })) };
    const singleFn = vi.fn(async () => ({ data: null, error: { message: "fetch error" } }));
    const leadsTable = {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleFn })) })),
    };

    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(refTable)
        .mockReturnValueOnce(leadsTable),
    };

    await expect(addCorroboratingSource("lead-1", candidate())).rejects.toThrow(
      "addCorroboratingSource lead fetch failed: fetch error"
    );
  });
});
