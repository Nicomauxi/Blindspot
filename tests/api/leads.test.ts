import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD_ID = "00000000-0000-0000-0000-000000000001";

let _orderCalls: Array<{ column: string; ascending?: boolean }> = [];

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
  address: "Av. 18 de Julio 123",
  niche: "restaurant",
  source: "google_places",
  canonical_source: "google_places",
  sources_count: 1,
  phone: "+598 99 123456",
  whatsapp: "+598 99 123456",
  website: "https://parrilla.example.com",
  rating: 4.7,
  review_count: 128,
  tags: ["whatsapp-confirmed", "no-website"],
  state: "discovered",
  owner_group_id: "11111111-2222-3333-4444-555555555555",
  digital_footprint: { fetched_at: "2026-01-01T00:00:00Z" },
  inferred_state: {
    has_delivery: { value: true, confidence: 0.9 },
    digitalization_level: "low",
  },
  score_breakdown: {
    contact_tier: "A",
    primary_offer: "software_pos",
    pitch_hook: "POS sin contrato",
    urgency_signal: "high",
  },
  notes: "Lead de prueba",
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
    Promise.resolve({ data: [mockLeadViewRow], error: null, count: 1 });
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
      return {};
    },
  }),
}));

describe("GET /api/v1/leads", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _orderCalls = [];
    _lastLlmUsageInsert = null;
    _mockLeadBriefError = null;
    _mockTemplateLeadBriefError = null;
    _mockLeadFeedbackRows = [];
    _lastLeadFeedbackInsert = null;
    _auditLogInserts = [];
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
