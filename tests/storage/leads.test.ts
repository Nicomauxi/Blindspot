import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDuplicateTagUpdates,
  detectDuplicates,
  listLeads,
  mergeFootprint,
  propagateChainWebsites,
  updateLeadEnrichment,
  upsertLeads,
} from "../../src/storage/leads.js";
import type { DigitalFootprint, Lead, PlaceCandidate, SocialSearch } from "../../src/shared/types.js";

const supabaseRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => supabaseRef.current),
}));

vi.mock("../../src/storage/service-pricing.js", () => ({
  getAdminServicePricing: vi.fn(async () => null),
}));

function socialSearch(source: "playwright" | "duckduckgo", confirmed: boolean): SocialSearch {
  if (source === "playwright") {
    return {
      ran_at: "2026-01-01T00:00:00.000Z",
      source,
      facebook: confirmed
        ? {
            url: "https://facebook.com/test",
            name: "Test",
            email: null,
            phone: null,
            website: null,
            description: null,
            whatsapp_button: false,
            confidence: 0.8,
            signals: ["page_loaded"],
          }
        : null,
      instagram: null,
    };
  }

  return {
    ran_at: "2026-01-01T00:00:00.000Z",
    source,
    facebook: {
      query: "q",
      results: [],
      best_url: confirmed ? "https://facebook.com/test" : null,
      additional_phones: [],
      confidence: confirmed ? 0.8 : 0,
    },
    instagram: {
      query: "q",
      results: [],
      best_url: null,
      additional_phones: [],
      confidence: 0,
    },
  };
}

function candidate(placeId = "place-1"): PlaceCandidate {
  return {
    placeId,
    name: "Test Business",
    formattedAddress: "Montevideo",
    rating: 4.5,
    userRatingCount: 100,
    websiteUri: null,
    phone: null,
    businessStatus: "OPERATIONAL",
    raw: {},
  };
}

function tagsFn(): string[] {
  return ["profile:a", "no-website"];
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "hairdresser",
    name: "Lead",
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
    first_seen_run_id: null,
    last_seen_run_id: null,
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
    ...overrides,
  };
}

function footprintWithIdentity(
  website: string | null,
  contactEmails: string[] = []
): DigitalFootprint {
  return {
    fetched_at: "2026-01-01T00:00:00.000Z",
    contact_emails: contactEmails,
    heuristic_discovery: {
      ran_at: "2026-01-01T00:00:00.000Z",
      mode: "full",
      stale: false,
      candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
      selected: {
        website: website
          ? {
              kind: "website",
              url: website,
              score: 0.9,
              signals: ["http-ok"],
              status: "probed",
              http_status: 200,
              final_url: website,
            }
          : null,
        facebook: null,
        instagram: null,
        whatsapp: null,
      },
    },
  };
}

describe("mergeFootprint", () => {
  it("preserves confirmed Facebook social search instead of downgrading", () => {
    const existing: DigitalFootprint = {
      fetched_at: "2026-01-01T00:00:00.000Z",
      social_search: socialSearch("playwright", true),
    };
    const fresh: DigitalFootprint = {
      fetched_at: "2026-01-02T00:00:00.000Z",
      social_search: socialSearch("duckduckgo", false),
    };

    expect(mergeFootprint(existing, fresh).social_search).toBe(existing.social_search);
  });

  it("preserves phone_confirmed true", () => {
    const existing: DigitalFootprint = {
      fetched_at: "2026-01-01T00:00:00.000Z",
      phone_confirmed: true,
    };
    const fresh: DigitalFootprint = {
      fetched_at: "2026-01-02T00:00:00.000Z",
      phone_confirmed: false,
    };

    expect(mergeFootprint(existing, fresh).phone_confirmed).toBe(true);
  });

  it("preserves existing contact emails when fresh has none", () => {
    const existing: DigitalFootprint = {
      fetched_at: "2026-01-01T00:00:00.000Z",
      contact_emails: ["ventas@test.uy"],
    };
    const fresh: DigitalFootprint = {
      fetched_at: "2026-01-02T00:00:00.000Z",
      contact_emails: [],
    };

    expect(mergeFootprint(existing, fresh).contact_emails).toEqual(["ventas@test.uy"]);
  });

  it("returns fresh unchanged when existing is null", () => {
    const fresh: DigitalFootprint = { fetched_at: "2026-01-02T00:00:00.000Z" };

    expect(mergeFootprint(null, fresh)).toBe(fresh);
  });
});

describe("detectDuplicates", () => {
  it("groups leads with the same heuristic website", () => {
    const a = lead({
      id: "a",
      name: "A",
      prospect_score: 20,
      digital_footprint: footprintWithIdentity("https://www.negocio.uy/"),
    });
    const b = lead({
      id: "b",
      name: "B",
      prospect_score: 40,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });

    const groups = detectDuplicates([a, b]);
    const group = [...groups.values()][0];

    expect(group?.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("groups leads with the same whatsapp", () => {
    const a = lead({ id: "a", whatsapp: "099123456" });
    const b = lead({ id: "b", whatsapp: "+59899123456" });

    const groups = detectDuplicates([a, b]);

    expect([...groups.values()][0]?.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("does not group leads that only share blocked-domain emails", () => {
    const a = lead({
      id: "a",
      digital_footprint: footprintWithIdentity(null, ["soporte@thinkit.com.uy"]),
    });
    const b = lead({
      id: "b",
      digital_footprint: footprintWithIdentity(null, ["soporte@thinkit.com.uy"]),
    });

    expect(detectDuplicates([a, b]).size).toBe(0);
  });

  it("returns an empty map for unrelated leads", () => {
    const a = lead({ id: "a", phone: "+598 2408 7679" });
    const b = lead({ id: "b", phone: "+598 2205 8745" });

    expect(detectDuplicates([a, b]).size).toBe(0);
  });

  it("uses the highest prospect_score as the primary lead", () => {
    const a = lead({
      id: "a",
      prospect_score: 10,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });
    const b = lead({
      id: "b",
      prospect_score: 90,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });

    const group = [...detectDuplicates([a, b]).values()][0];

    expect(group?.[0]?.id).toBe("b");
  });
});

describe("buildDuplicateTagUpdates (F5.1)", () => {
  it("saca al secundario del pool: passed_filter=false + rejection reason", () => {
    const a = lead({
      id: "a",
      prospect_score: 90,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });
    const b = lead({
      id: "b",
      prospect_score: 10,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });

    const updates = buildDuplicateTagUpdates(detectDuplicates([a, b]));
    const primary = updates.find((u) => u.id === "a");
    const secondary = updates.find((u) => u.id === "b");

    expect(primary?.tags).toContain("possible-duplicate");
    expect(primary?.passed_filter).toBeUndefined();

    expect(secondary?.tags).toContain("duplicate-secondary");
    expect(secondary?.passed_filter).toBe(false);
    expect(secondary?.rejection_reasons).toContain("duplicate-secondary");
  });

  it("al PRIMARIO se le limpia un duplicate-secondary viejo (era secundario, hoy gana)", () => {
    const a = lead({
      id: "a",
      prospect_score: 90,
      tags: ["possible-duplicate", "duplicate-secondary"], // tag arrastrado de un run viejo
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });
    const b = lead({
      id: "b",
      prospect_score: 10,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });

    const updates = buildDuplicateTagUpdates(detectDuplicates([a, b]));
    const primary = updates.find((u) => u.id === "a");

    expect(primary?.tags).not.toContain("duplicate-secondary");
    expect(primary?.tags).toContain("possible-duplicate");
  });

  it("no duplica la razón si el secundario ya la tenía", () => {
    const a = lead({
      id: "a",
      prospect_score: 90,
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });
    const b = lead({
      id: "b",
      prospect_score: 10,
      rejection_reasons: ["duplicate-secondary"],
      digital_footprint: footprintWithIdentity("https://negocio.uy"),
    });

    const updates = buildDuplicateTagUpdates(detectDuplicates([a, b]));
    const secondary = updates.find((u) => u.id === "b");

    expect(secondary?.rejection_reasons).toEqual(["duplicate-secondary"]);
  });
});

describe("propagateChainWebsites", () => {
  it("persiste el dominio dominante en las fichas del mismo negocio sin web", async () => {
    const updates: Array<{ id: string; website: string }> = [];
    supabaseRef.current = {
      from: () => ({
        update: (patch: { website: string }) => ({
          eq: (_col: string, id: string) => {
            updates.push({ id, website: patch.website });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    const leads = [
      { id: "1", name: "Tienda Inglesa", website: "https://www.tiendainglesa.com.uy/" },
      { id: "2", name: "Tienda Inglesa", website: "http://www.tiendainglesa.com.uy/" },
      { id: "3", name: "Tienda Inglesa", website: null },
      { id: "9", name: "La Pasiva", website: "https://instagram.com/lapasiva" }, // social → no propaga
      { id: "10", name: "La Pasiva", website: null },
    ] as unknown as Lead[];

    const applied = await propagateChainWebsites(leads);
    expect(applied).toBe(1);
    expect(updates).toEqual([{ id: "3", website: "https://www.tiendainglesa.com.uy/" }]);
  });

  it("no hace nada si no hay propagaciones", async () => {
    supabaseRef.current = { from: () => { throw new Error("no debería llamar a la DB"); } };
    const applied = await propagateChainWebsites([{ id: "1", name: "Solo", website: null } as unknown as Lead]);
    expect(applied).toBe(0);
  });
});

describe("listLeads", () => {
  function makeQuery() {
    const query = {
      data: [],
      error: null,
      eq: vi.fn(() => query),
      limit: vi.fn(() => query),
      order: vi.fn(() => query),
    };
    const select = vi.fn(() => ({ order: query.order }));
    supabaseRef.current = { from: vi.fn(() => ({ select })) };
    return { query, select };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by first_seen_run_id when runId is provided", async () => {
    const { query } = makeQuery();

    await listLeads({ runId: "run-1" });

    expect(query.eq).toHaveBeenCalledWith("first_seen_run_id", "run-1");
  });

  it("filters by last_seen_run_id when seenInRunId is provided", async () => {
    const { query } = makeQuery();

    await listLeads({ seenInRunId: "run-2" });

    expect(query.eq).toHaveBeenCalledWith("last_seen_run_id", "run-2");
  });

  it("filters passed_filter when passedOnly is true", async () => {
    const { query } = makeQuery();

    await listLeads({ passedOnly: true });

    expect(query.eq).toHaveBeenCalledWith("passed_filter", true);
  });

  it("applies limit when provided", async () => {
    const { query } = makeQuery();

    await listLeads({ limit: 5 });

    expect(query.limit).toHaveBeenCalledWith(5);
  });
});

describe("updateLeadEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when select returns error", async () => {
    const single = vi.fn(async () => ({ data: null, error: { message: "select failed" } }));
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    supabaseRef.current = { from: vi.fn(() => ({ select })) };

    await expect(updateLeadEnrichment("lead-1", { fetched_at: "now" }, [], null))
      .rejects.toThrow("Failed to load lead lead-1: select failed");
  });

  it("throws when select returns no data (lead not found)", async () => {
    // After consolidating 3 UPDATEs into 1 (B5 fix), the post-UPDATE `data: null`
    // path no longer exists — the only "row missing" branch is on the initial
    // SELECT. The test now asserts that branch.
    const single = vi.fn(async () => ({ data: null, error: null }));
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    supabaseRef.current = {
      from: vi.fn(() => ({ select })),
    };

    await expect(updateLeadEnrichment("lead-2", { fetched_at: "now" }, [], null))
      .rejects.toThrow("Supabase returned no row for leadId=lead-2");
  });

  it("throws when UPDATE returns an error", async () => {
    const single = vi.fn(async () => ({
      data: {
        id: "lead-2b",
        name: "Test",
        tags: [],
        whatsapp: null,
        phone: null,
        canonical_fields: null,
        digital_footprint: null,
        score_breakdown: null,
        inferred_state: null,
      },
      error: null,
    }));
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    const updateEq = vi.fn(async () => ({ error: { message: "update failed" } }));
    const update = vi.fn(() => ({ eq: updateEq }));
    supabaseRef.current = {
      from: vi.fn(() => ({ select, update })),
    };

    await expect(updateLeadEnrichment("lead-2b", { fetched_at: "now" }, [], null))
      .rejects.toThrow("Failed to update lead lead-2b: update failed");
  });

  it("keeps existing normalized whatsapp before whatsappFromSite", async () => {
    const single = vi.fn(async () => ({
      data: {
        tags: [],
        whatsapp: "094123456",
        phone: null,
        canonical_fields: null,
        digital_footprint: null,
      },
      error: null,
    }));
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    let updatePayload: Record<string, unknown> | null = null;
    const updateSingle = vi.fn(async () => ({
      data: {
        id: "lead-3",
        source: "google_places",
        tags: [],
        whatsapp: "+59894123456",
        phone: null,
        canonical_fields: null,
        digital_footprint: { fetched_at: "now" },
      },
      error: null,
    }));
    const update = vi.fn((payload: Record<string, unknown>) => {
      if ("contact_reliability_score" in payload) {
        updatePayload = payload;
      }
      return { eq: vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingle })) })) };
    });
    supabaseRef.current = {
      from: vi.fn((table: string) => {
        if (table === "leads") return { select, update };
        if (table === "lead_buyer_scores") {
          return { upsert: vi.fn(async () => ({ error: null })) };
        }
        return { select, update };
      }),
    };

    await updateLeadEnrichment("lead-3", { fetched_at: "now" }, [], "099999999");

    expect(updatePayload?.whatsapp).toBe("+59894123456");
    expect(updatePayload?.tags).toEqual(expect.arrayContaining(["whatsapp-derived"]));
  });

  it("persists contact_reliability_score and email-no-mx tags from enrichment data", async () => {
    // After B5 consolidation, SELECT now reads "*" and the rescore runs in
    // memory against `simulatedLead` BEFORE the single consolidated UPDATE.
    // The mock must therefore return all Lead fields scoreLead reads.
    const single = vi.fn(async () => ({
      data: {
        id: "lead-4",
        place_id: "place-4",
        source: "google_places",
        external_id: "place-4",
        source_confidence: 0.9,
        source_data: null,
        data_confidence_score: 0.8,
        contact_reliability_score: 0.5,
        canonical_fields: null,
        corroborating_sources: [],
        canonical_source: null,
        owner_group_id: null,
        lead_company_data: null,
        niche: "restaurant",
        name: "Negocio",
        address: null,
        rating: 4.1,
        review_count: 20,
        website: "https://negocio.uy",
        whatsapp: null,
        phone: "+59824087679",
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
        prospect_score: null,
        scoring_version: null,
        contact_ready: null,
        prospect_score_v1: null,
        passed_filter: true,
        rejection_reasons: [],
        score_breakdown: null,
        score_breakdown_v1: null,
        systems_gap_breakdown: null,
        contacted_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    }));
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    let updatePayload: Record<string, unknown> | null = null;
    const updateEq = vi.fn(async () => ({ error: null }));
    const update = vi.fn((payload: Record<string, unknown>) => {
      if ("contact_reliability_score" in payload) {
        updatePayload = payload;
      }
      return { eq: updateEq };
    });
    supabaseRef.current = {
      from: vi.fn((table: string) => {
        if (table === "leads") return { select, update };
        if (table === "lead_buyer_scores") {
          return { upsert: vi.fn(async () => ({ error: null })) };
        }
        return { select, update };
      }),
    };

    await updateLeadEnrichment("lead-4", {
      fetched_at: "now",
      contact_emails: ["info@negocio.uy"],
      email_quality: [{
        email: "info@negocio.uy",
        quality: "generic",
        domain_match: false,
        mx_valid: false,
        reliability_multiplier: 0.5,
      }],
    }, ["email-found"], null);

    expect(updatePayload?.contact_reliability_score).toBe(0.23);
    expect(updatePayload?.tags).toEqual(expect.arrayContaining([
      "email-found",
      "email-no-mx",
      "landline-phone",
    ]));
  });
});

describe("upsertLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws with placeId when insert returns null data", async () => {
    const fetchTable = {
      select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })),
    };
    const insertTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })),
      })),
    };
    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(fetchTable)
        .mockReturnValueOnce(insertTable),
    };

    await expect(upsertLeads(
      [{ candidate: candidate("insert-null"), passed: true, rejection_reasons: [] }],
      "run-1",
      "a",
      tagsFn
    )).rejects.toThrow("Supabase returned no row for placeId=insert-null");
  });

  it("throws with placeId when update returns null data", async () => {
    const existing = {
      place_id: "update-null",
      tags: ["profile:a"],
      passed_filter: true,
      rejection_reasons: [],
    };
    const fetchTable = {
      select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [existing], error: null })) })),
    };
    const updateTable = {
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })),
        })),
      })),
    };
    supabaseRef.current = {
      from: vi.fn()
        .mockReturnValueOnce(fetchTable)
        .mockReturnValueOnce(updateTable),
    };

    await expect(upsertLeads(
      [{ candidate: candidate("update-null"), passed: true, rejection_reasons: [] }],
      "run-1",
      "a",
      tagsFn
    )).rejects.toThrow("Supabase returned no row for placeId=update-null");
  });
});
