import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD_ID = "00000000-0000-0000-0000-000000000001";
const geocodeAddress = vi.fn();

let _orderCalls: Array<{ column: string; ascending?: boolean }> = [];
let _mockLeadQueryRows: Array<Record<string, unknown>> = [];

let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};
let _lastLlmUsageInsert: Record<string, unknown> | null = null;
let _mockLeadBriefError: Error | null = null;
let _mockTemplateLeadBriefError: Error | null = null;
let _mockLeadFeedbackRows: Array<Record<string, unknown>> = [];
let _lastLeadFeedbackInsert: Record<string, unknown> | null = null;
let _auditLogInserts: Array<Record<string, unknown>> = [];
let _trackedLeadIds = new Set<string>();
let _trackingStatuses = new Map<string, string>();

const mockLeadBrief = {
  summary: "Resumen comercial",
  why_it_matters: "Importa porque hay intencion de compra.",
  next_step: "Escribir por WhatsApp.",
  recommended_channel: "whatsapp",
  personalized_pitch: "Entrar por POS sin contrato.",
  first_message: "Hola, vi una mejora concreta para tu operacion.",
  likely_objections: ["Ahora no"],
  objection_handling: ["Proponer prueba corta"],
  source_llm: "gemini",
  generated_at: "2026-01-01T00:00:00Z",
  provider: "gemini",
  model: "gemini-2.5-flash",
  tokens_in: 12,
  tokens_out: 34,
  cost_usd_estimated: 0.002,
};

const mockTemplateLeadBrief = {
  ...mockLeadBrief,
  summary: "Resumen fallback",
  source_llm: "template",
  provider: "template",
  model: "template-v1",
  tokens_in: 0,
  tokens_out: 0,
  cost_usd_estimated: 0,
};

const mockLeadViewRow = {
  id: LEAD_ID,
  name: "Parrilla Don Jorge",
  address: "Av. 18 de Julio 123, Montevideo",
  niche: "restaurant",
  source: "google_places",
  canonical_source: "google_places",
  sources_count: 1,
  phone: "+598 99 123456",
  whatsapp: "+598 99 123456",
  email: "ventas@parrilla.example.com",
  website: "https://parrilla.example.com",
  rating: 4.7,
  review_count: 128,
  tags: ["whatsapp-confirmed", "no-website"],
  state: "discovered",
  owner_group_id: "11111111-2222-3333-4444-555555555555",
  digital_footprint: {
    fetched_at: "2026-01-01T00:00:00Z",
    contact_emails: ["ventas@parrilla.example.com"],
    owner_email: "dueno@parrilla.example.com",
    phone_alternatives: ["+598 98 111 222"],
    email_quality: [{ email: "ventas@parrilla.example.com", quality: "generic", mx_valid: true }],
    nested: { contact_phone: "+598 99 123456", additional_phones: ["+598 97 333 444"] },
  },
  inferred_state: {
    has_delivery: { value: true, confidence: 0.9 },
    digitalization_level: "low",
  },
  score_breakdown: {
    contact_tier: "A",
    primary_offer: "software_pos",
    pitch_hook: "POS sin contrato",
    urgency_signal: "high",
    sub_scores: {
      software: 62,
      marketing: 24,
      web_nuevo: 0,
      rediseno: 0,
      catalogo: 0,
      primary_offer: "software",
    },
  },
  notes: "Lead de prueba",
  lead_company_data: {
    sales_contact_email: "ventas@parrilla.example.com",
    manager_phone: "+598 99 123456",
  },
  canonical_fields: {
    phone: { value: "+598 99 123456", source: "google_places", confidence: 0.9 },
    email: { value: "ventas@parrilla.example.com", source: "website", confidence: 0.8 },
    website: { value: "https://parrilla.example.com", source: "google_places", confidence: 0.9 },
  },
  business_status: "OPERATIONAL",
  source_confidence: 0.9,
  data_confidence_score: 0.85,
  contact_reliability_score: 0.92,
  contact_ready: true,
  prospect_score: 78,
  contact_tier: "A",
  primary_offer: "software_pos",
  pitch_hook: "POS sin contrato",
  urgency_signal: "high",
  gps: { lat: -34.905, lng: -56.191 },
  contacted_at: null,
  contacted_by: null,
  created_at: "2026-01-01T00:00:00Z",
  corroborating_sources: [],
  top_buyer_type: "software_pos",
  top_buyer_score: 82,
  search_vector: "'parrilla':1",
};

const mockRejectedLeadRow = {
  ...mockLeadViewRow,
  id: "00000000-0000-0000-0000-000000000099",
  canonical_fields: {
    phone: { value: "+598 98 765432" },
    website: { value: "https://rejected.example.com" },
  },
  phone: null,
  website: null,
};

function makeLeadQueryChain() {
  const chain: Record<string, unknown> = {};
  const terminal = () =>
    Promise.resolve({ data: _mockLeadQueryRows, error: null, count: _mockLeadQueryRows.length });
  const leaf = () => chain;
  chain["in"] = leaf;
  chain["eq"] = (_col: string, val: string) => {
    if (_col === "id") {
      return {
        single: async () =>
          val === LEAD_ID
            ? { data: mockLeadViewRow, error: null }
            : { data: null, error: { code: "PGRST116" } },
      };
    }
    return chain;
  };
  chain["gte"] = leaf;
  chain["textSearch"] = leaf;
  chain["or"] = leaf;
  chain["lt"] = leaf;
  chain["order"] = (column: string, opts?: { ascending?: boolean }) => {
    _orderCalls.push({ column, ascending: opts?.ascending });
    return chain;
  };
  chain["limit"] = terminal;
  chain["single"] = async () => ({ data: null, error: { code: "PGRST116" } });
  return chain;
}

function makeLeadFeedbackQueryChain() {
  let rows = [..._mockLeadFeedbackRows];
  const chain: Record<string, unknown> = {};
  chain["eq"] = (column: string, value: string) => {
    rows = rows.filter((row) => row[column] === value);
    return chain;
  };
  chain["order"] = () => {
    rows = rows.slice().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return chain;
  };
  chain["limit"] = async (value: number) => ({
    data: rows.slice(0, value),
    error: null,
    count: rows.length,
  });
  return chain;
}


vi.mock("../../api/src/llm/factory.js", () => ({
  createLLMProvider: () => ({
    name: "gemini",
    model: "gemini-2.5-flash",
    generateLeadBrief: async () => {
      if (_mockLeadBriefError) throw _mockLeadBriefError;
      return mockLeadBrief;
    },
  }),
}));

vi.mock("../../api/src/llm/template.js", () => ({
  TemplateProvider: class {
    async generateLeadBrief() {
      if (_mockTemplateLeadBriefError) throw _mockTemplateLeadBriefError;
      return mockTemplateLeadBrief;
    }
  },
}));

vi.mock("../../api/src/services/lead-geocoding.js", () => ({
  createLeadGeocodingService: () => ({ geocodeAddress }),
}));

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: _mockUser, error: null }),
            }),
          }),
        };
      }
      if (table === "lead_dashboard") {
        return {
          select: (_cols: string, _opts?: unknown) => makeLeadQueryChain(),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              single: async () =>
                val === mockRejectedLeadRow.id
                  ? { data: mockRejectedLeadRow, error: null }
                  : { data: null, error: { code: "PGRST116" } },
            }),
            in: (_col: string, values: string[]) => Promise.resolve({
              data: _mockLeadQueryRows
                .filter((row) => values.includes(String(row.id)))
                .map((row) => ({ id: row.id, gps: row.gps ?? null })),
              error: null,
            }),
          }),
        };
      }
      if (table === "pipeline_config") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "singleton",
                  enabled: false,
                  cron_expression: "0 2 * * 0",
                  scheduled_for: null,
                  last_completed_at: null,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "pipeline_runs") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
          }),
        };
      }
      if (table === "llm_usage_log") {
        return {
          insert: (payload: unknown) => {
            _lastLlmUsageInsert = payload as Record<string, unknown>;
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "lead_feedback") {
        return {
          select: () => makeLeadFeedbackQueryChain(),
          insert: (payload: unknown) => {
            _lastLeadFeedbackInsert = payload as Record<string, unknown>;
            const row = {
              id: `feedback-${_mockLeadFeedbackRows.length + 1}`,
              created_at: `2026-01-0${_mockLeadFeedbackRows.length + 1}T00:00:00Z`,
              ...(payload as Record<string, unknown>),
            };
            _mockLeadFeedbackRows = [row, ..._mockLeadFeedbackRows];
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          },
        };
      }
      if (table === "audit_log") {
        return {
          insert: (payload: unknown) => {
            _auditLogInserts.push(payload as Record<string, unknown>);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "lead_tracking") {
        return {
          select: () => {
            let ownerId: string | null = null;
            let leadId: string | null = null;
            let leadIds: string[] | null = null;
            let statuses: string[] | null = null;
            const buildRows = () => {
              if (!ownerId) return [] as Array<Record<string, unknown>>;
              return [..._trackedLeadIds]
                .filter((trackedLeadId) => !leadId || trackedLeadId === leadId)
                .filter((trackedLeadId) => !leadIds || leadIds.includes(trackedLeadId))
                .filter((trackedLeadId) => !statuses || statuses.includes(_trackingStatuses.get(trackedLeadId) ?? "pending"))
                .map((trackedLeadId) => ({
                  id: `tracking-${trackedLeadId}`,
                  lead_id: trackedLeadId,
                  owner_id: ownerId,
                  status: _trackingStatuses.get(trackedLeadId) ?? "pending",
                }));
            };
            const chain: Record<string, unknown> = {};
            chain["eq"] = (column: string, value: unknown) => {
              if (column === "owner_id") ownerId = String(value);
              if (column === "lead_id") leadId = String(value);
              return chain;
            };
            chain["in"] = (column: string, values: unknown[]) => {
              if (column === "lead_id") leadIds = values.map(String);
              if (column === "status") statuses = values.map(String);
              return chain;
            };
            chain["then"] = (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve({ data: buildRows(), error: null }).then(resolve, reject);
            chain["limit"] = () => ({
              maybeSingle: async () => ({ data: buildRows()[0] ?? null, error: null }),
              then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
                Promise.resolve({ data: buildRows(), error: null }).then(resolve, reject),
            });
            chain["maybeSingle"] = async () => ({ data: buildRows()[0] ?? null, error: null });
            return chain;
          },
        };
      }
      return {};
    },
  }),
}));

describe("GET /api/v1/leads", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _orderCalls = [];
    _mockLeadQueryRows = [mockLeadViewRow];
    _lastLlmUsageInsert = null;
    _mockLeadBriefError = null;
    _mockTemplateLeadBriefError = null;
    _mockLeadFeedbackRows = [];
    _lastLeadFeedbackInsert = null;
    _auditLogInserts = [];
    _trackedLeadIds = new Set();
    _trackingStatuses = new Map();
    geocodeAddress.mockReset();
    geocodeAddress.mockResolvedValue(null);
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("returns 401 without auth token", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/leads" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns the canonical LeadDashboard contract", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("next_cursor");
    expect(body).toHaveProperty("total");
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: LEAD_ID,
        phone: mockLeadViewRow.phone,
        whatsapp: mockLeadViewRow.whatsapp,
        website: mockLeadViewRow.website,
        rating: mockLeadViewRow.rating,
        review_count: mockLeadViewRow.review_count,
        tags: mockLeadViewRow.tags,
        state: mockLeadViewRow.state,
        owner_group_id: mockLeadViewRow.owner_group_id,
        contact_tier: "A",
        primary_offer: "software_pos",
      })
    );

    await app.close();
  });

  it("CM with null lead_filter returns empty results (fail closed)", async () => {
    _mockUser = {
      id: "cm-null-filter-id",
      email: "cmnull@blindspot.local",
      role: "cm",
      lead_filter: null,
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({
      user_id: "cm-null-filter-id",
      email: "cmnull@blindspot.local",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], next_cursor: null, total: 0 });
    await app.close();
  });

  it("includes a derived commercial offer summary in lead list responses", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].commercial_offers_summary).toMatchObject({
      primary_offer_type: "both",
      software_score: 62,
      marketing_score: 24,
      top_software_offer: "software",
      top_marketing_offer: "marketing",
    });
    await app.close();
  });

  it("filters leads by derived commercial offer type on the backend", async () => {
    _mockLeadQueryRows = [
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000011",
        name: "Lead marketing",
        created_at: "2026-01-04T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 0, marketing: 55, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "marketing" },
        },
        tags: ["web-only-no-social"],
      },
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000012",
        name: "Lead software",
        created_at: "2026-01-03T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 71, marketing: 0, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "software" },
        },
        tags: ["whatsapp-missing"],
      },
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000013",
        name: "Lead mixto",
        created_at: "2026-01-02T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 45, marketing: 38, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "software" },
        },
        tags: ["web-only-no-social", "whatsapp-missing"],
      },
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000014",
        name: "Lead sin señal",
        created_at: "2026-01-01T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 0, marketing: 0, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "none" },
        },
        tags: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?commercial_offer_type=marketing",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((lead: { name: string }) => lead.name)).toEqual(["Lead marketing"]);
    await app.close();
  });

  it("sorts leads by derived software score on the backend", async () => {
    _mockLeadQueryRows = [
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000021",
        name: "Lead software medio",
        created_at: "2026-01-02T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 41, marketing: 10, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "software" },
        },
      },
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000022",
        name: "Lead software alto",
        created_at: "2026-01-03T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 88, marketing: 5, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "software" },
        },
      },
      {
        ...mockLeadViewRow,
        id: "00000000-0000-0000-0000-000000000023",
        name: "Lead software bajo",
        created_at: "2026-01-01T00:00:00Z",
        score_breakdown: {
          ...mockLeadViewRow.score_breakdown,
          sub_scores: { software: 12, marketing: 22, web_nuevo: 0, rediseno: 0, catalogo: 0, primary_offer: "marketing" },
        },
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?sort_by=software_score&sort_direction=desc",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((lead: { name: string }) => lead.name)).toEqual([
      "Lead software alto",
      "Lead software medio",
      "Lead software bajo",
    ]);
    await app.close();
  });

  it("respects sort_direction=asc for created_at ordering", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?sort_by=created_at&sort_direction=asc",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(_orderCalls.slice(-2)).toEqual([
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ]);
    await app.close();
  });

  it("redacts contact fields for CM users until they start tracking the lead", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toEqual(
      expect.objectContaining({
        phone: "***",
        whatsapp: "***",
        email: "***",
      })
    );
    expect(res.json().data[0].canonical_fields.phone.value).toBe("***");
    expect(res.json().data[0].digital_footprint.contact_emails).toEqual(["***"]);
    expect(res.json().data[0].digital_footprint.phone_alternatives).toEqual(["***"]);
    expect(res.json().data[0].digital_footprint.email_quality[0].email).toBe("***");
    expect(res.json().data[0].lead_company_data.sales_contact_email).toBe("***");
    await app.close();
  });

  it("restores contact fields in list responses once the CM tracks the lead", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };
    _trackedLeadIds = new Set([LEAD_ID]);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toEqual(
      expect.objectContaining({
        phone: mockLeadViewRow.phone,
        whatsapp: mockLeadViewRow.whatsapp,
        email: mockLeadViewRow.email,
      })
    );
    await app.close();
  });

  it("CM requesting a tier outside their filter returns empty intersection", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?contact_tier=B",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    await app.close();
  });

  it("filters leads by structured parent/grid selection and geocoded fallback", async () => {
    const { buildGridCell, buildLeadLocationKey } = await import("../../api/src/routes/discovery-insights.js");
    const geocodedRow = {
      ...mockLeadViewRow,
      id: "00000000-0000-0000-0000-000000000002",
      name: "Cafe Pocitos",
      address: "Benito Blanco 900, Montevideo",
      gps: null,
    };
    // Put the first lead's GPS in a completely different cell so it doesn't match the target grid zone.
    const otherCityRow = { ...mockLeadViewRow, gps: { lat: -33.0, lng: -56.0 } };
    _mockLeadQueryRows = [otherCityRow, geocodedRow];
    geocodeAddress.mockImplementation(async (address: string) =>
      address.includes("Benito Blanco") ? { lat: -34.904, lng: -56.19 } : null
    );

    const cell = buildGridCell({ lat: -34.904, lng: -56.19, source: "geocoded" });
    const parentLocationKey = buildLeadLocationKey(geocodedRow.address);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads?parent_location_keys=${encodeURIComponent(parentLocationKey)}&grid_location_keys=${encodeURIComponent(cell.gridKey)}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((lead: { id: string }) => lead.id)).toEqual([
      "00000000-0000-0000-0000-000000000002",
    ]);
    expect(res.json().total).toBe(1);
    expect(geocodeAddress).toHaveBeenCalled();
    await app.close();
  });

  it("filters leads by location_key using the same parent/grid contract", async () => {
    const { buildGridCell, buildLeadLocationKey } = await import("../../api/src/routes/discovery-insights.js");
    const geocodedRow = {
      ...mockLeadViewRow,
      id: "00000000-0000-0000-0000-000000000002",
      name: "Cafe Pocitos",
      address: "Benito Blanco 900, Montevideo",
      gps: null,
    };
    // Put the first lead's GPS in a completely different cell so it doesn't match the target grid zone.
    const otherCityRow = { ...mockLeadViewRow, gps: { lat: -33.0, lng: -56.0 } };
    _mockLeadQueryRows = [otherCityRow, geocodedRow];
    geocodeAddress.mockImplementation(async (address: string) =>
      address.includes("Benito Blanco") ? { lat: -34.904, lng: -56.19 } : null
    );

    const cell = buildGridCell({ lat: -34.904, lng: -56.19, source: "geocoded" });
    const parentLocationKey = buildLeadLocationKey(geocodedRow.address);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads?location_key=${encodeURIComponent(`${parentLocationKey}::${cell.gridKey}`)}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((lead: { id: string }) => lead.id)).toEqual([
      "00000000-0000-0000-0000-000000000002",
    ]);
    expect(res.json().total).toBe(1);
    await app.close();
  });
});

describe("GET /api/v1/leads/:id", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
    _mockLeadFeedbackRows = [];
    _lastLeadFeedbackInsert = null;
    _auditLogInserts = [];
    _trackedLeadIds = new Set();
    _trackingStatuses = new Map();
  });

  it("returns 401 without token", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: `/api/v1/leads/${LEAD_ID}` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 404 for non-uuid id", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/not-a-uuid",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns the canonical LeadDetail contract", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(
      expect.objectContaining({
        id: LEAD_ID,
        digital_footprint: mockLeadViewRow.digital_footprint,
        inferred_state: mockLeadViewRow.inferred_state,
        score_breakdown: mockLeadViewRow.score_breakdown,
        business_status: mockLeadViewRow.business_status,
        source_confidence: mockLeadViewRow.source_confidence,
        canonical_source: mockLeadViewRow.canonical_source,
      })
    );

    await app.close();
  });

  it("normalizes raw lead rows when admin requests include_rejected=true", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${mockRejectedLeadRow.id}?include_rejected=true`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(
      expect.objectContaining({
        id: mockRejectedLeadRow.id,
        phone: "+598 98 765432",
        website: "https://rejected.example.com",
      })
    );

    await app.close();
  });

  it("returns 404 for CM with null lead_filter", async () => {
    _mockUser = {
      id: "cm-null-filter-id",
      email: "cmnull@blindspot.local",
      role: "cm",
      lead_filter: null,
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({
      user_id: "cm-null-filter-id",
      email: "cmnull@blindspot.local",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("CM returns 404 for lead outside their filter", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["C"] },
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("redacts nested contact data for CM users without active tracking", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A", "B"] },
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(
      expect.objectContaining({
        phone: "***",
        whatsapp: "***",
        email: "***",
      })
    );
    expect(res.json().data.canonical_fields.phone.value).toBe("***");
    expect(res.json().data.digital_footprint.owner_email).toBe("***");
    expect(res.json().data.digital_footprint.phone_alternatives).toEqual(["***"]);
    expect(res.json().data.digital_footprint.email_quality[0].email).toBe("***");
    expect(res.json().data.digital_footprint.nested.contact_phone).toBe("***");
    expect(res.json().data.digital_footprint.nested.additional_phones).toEqual(["***"]);
    expect(res.json().data.lead_company_data.manager_phone).toBe("***");
    await app.close();
  });

  it("keeps contact redacted when the only tracking is terminal", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A", "B"] },
      active: true,
    };
    _trackedLeadIds = new Set([LEAD_ID]);
    _trackingStatuses = new Map([[LEAD_ID, "accepted"]]);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    const detailRes = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data[0].phone).toBe("***");
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().data.phone).toBe("***");
    await app.close();
  });
  it("unlocks contact data for tracked leads only", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A", "B"] },
      active: true,
    };
    _trackedLeadIds = new Set([LEAD_ID]);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(
      expect.objectContaining({
        phone: mockLeadViewRow.phone,
        whatsapp: mockLeadViewRow.whatsapp,
        email: mockLeadViewRow.email,
      })
    );
    expect(res.json().data.canonical_fields.phone.value).toBe(mockLeadViewRow.canonical_fields.phone.value);
    await app.close();
  });

  it("CM returns 200 for lead inside their filter", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A", "B"] },
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("Lead feedback routes", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
    _mockLeadFeedbackRows = [
      {
        id: "feedback-1",
        lead_id: LEAD_ID,
        field_key: "phone",
        field_value: "+59899123456",
        verdict: "good",
        comment: "Telefono confirmado",
        actor_user_id: "admin-user-id",
        actor_role: "admin",
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        id: "feedback-2",
        lead_id: LEAD_ID,
        field_key: "phone",
        field_value: "+59899123456",
        verdict: "bad",
        comment: "Tenia un digito mal",
        actor_user_id: "cm-user-id",
        actor_role: "cm",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "feedback-3",
        lead_id: LEAD_ID,
        field_key: "website",
        field_value: "https://parrilla.example.com",
        verdict: "good",
        comment: null,
        actor_user_id: "admin-user-id",
        actor_role: "admin",
        created_at: "2025-12-31T00:00:00Z",
      },
    ];
    _lastLeadFeedbackInsert = null;
    _auditLogInserts = [];
  });

  it("GET /api/v1/leads/:id/feedback lists persisted feedback", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}/feedback?field_key=phone&limit=10`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 2, lead_id: LEAD_ID });
    expect(res.json().data).toHaveLength(2);
    expect(res.json().data[0]).toMatchObject({ field_key: "phone", verdict: "good" });
    await app.close();
  });

  it("GET /api/v1/leads/:id/feedback-summary aggregates feedback by field", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}/feedback-summary`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      expect.objectContaining({ field_key: "phone", total: 2, good_count: 1, bad_count: 1, latest_verdict: "good" }),
      expect.objectContaining({ field_key: "website", total: 1, good_count: 1, bad_count: 0, latest_verdict: "good" }),
    ]);
    await app.close();
  });

  it("POST /api/v1/leads/:id/feedback creates feedback and audit trail", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/leads/${LEAD_ID}/feedback`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ field_key: "whatsapp", field_value: "+59899123456", verdict: "good", comment: "Confirmado por contacto directo" }),
    });

    expect(res.statusCode).toBe(201);
    expect(_lastLeadFeedbackInsert).toMatchObject({
      lead_id: LEAD_ID,
      field_key: "whatsapp",
      verdict: "good",
      actor_user_id: "admin-user-id",
      actor_role: "admin",
    });
    expect(_auditLogInserts[0]).toMatchObject({
      action: "lead.feedback.create",
      target_type: "lead",
      target_id: LEAD_ID,
    });
    await app.close();
  });

  it("CM gets 404 when trying to read feedback for a lead outside their filter", async () => {
    _mockUser = {
      id: "cm-user-id",
      email: "cm@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["C"] },
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-user-id", email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}/feedback`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /api/v1/leads/:id/feedback-adjusted-confidence returns adjusted scores", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}/feedback-adjusted-confidence`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lead_id).toBe(LEAD_ID);
    expect(body.data).toMatchObject({
      contact_delta: expect.any(Number),
      data_delta: expect.any(Number),
      flagged_fields: expect.any(Array),
      confirmed_fields: expect.any(Array),
    });
    // phone latest verdict is "good" after the mock data; website is "good" — both confirmed
    expect(body.data.confirmed_fields).toContain("website");
    // scores should be adjusted from base (0.92 contact, 0.85 data)
    expect(typeof body.data.contact_reliability_score).toBe("number");
    expect(typeof body.data.data_confidence_score).toBe("number");
    await app.close();
  });

  it("GET /api/v1/leads/:id/feedback-adjusted-confidence returns 404 for unknown lead", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/00000000-0000-0000-0000-000000000099/feedback-adjusted-confidence`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});


describe("POST /api/v1/leads/:id/assistant-brief", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _lastLlmUsageInsert = null;
    _mockLeadBriefError = null;
    _mockTemplateLeadBriefError = null;
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("returns a fallback brief and logs degraded success when provider fails", async () => {
    _mockLeadBriefError = new Error("Gemini API error: 429");

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/leads/${LEAD_ID}/assistant-brief`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      summary: mockTemplateLeadBrief.summary,
      source_llm: "template",
    });
    expect(_lastLlmUsageInsert).toMatchObject({
      operation: "lead_brief",
      success: true,
      error: "fallback:Gemini API error: 429",
    });

    await app.close();
  });

  it("returns assistant_unavailable when provider and template both fail", async () => {
    _mockLeadBriefError = new Error("Gemini API error: 500");
    _mockTemplateLeadBriefError = new Error("Template render failed");

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/leads/${LEAD_ID}/assistant-brief`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error_code: "assistant_unavailable" });
    expect(_lastLlmUsageInsert).toMatchObject({
      operation: "lead_brief",
      success: false,
      error: "primary:Gemini API error: 500; fallback:Template render failed",
    });

    await app.close();
  });
});
