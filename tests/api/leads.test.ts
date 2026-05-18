import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock data
const mockLeads = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Parrilla Don Jorge",
    address: "Av. 18 de Julio 123",
    niche: "restaurant",
    source: "google",
    sources_count: 1,
    contact_tier: "A",
    contact_email: "jorge@parrilla.com",
    contact_phone: "+598 99 123456",
    contact_whatsapp: null,
    prospect_score: 78,
    primary_offer: "software_pos",
    pitch_hook: "POS sin contrato",
    urgency_signal: "high",
    digitalization_level: "low",
    has_delivery: false,
    has_pos: false,
    has_reservations: false,
    data_confidence_score: 0.85,
    contact_reliability_score: 0.9,
    contact_ready: true,
    contacted_at: null,
    contacted_by: null,
    created_at: "2026-01-01T00:00:00Z",
    has_osm_source: false,
    corroborating_sources: [],
    top_buyer_type: "software_pos",
    top_buyer_score: 82,
  },
];

// Mutable state used by the factory below
let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

function makeLeadQueryChain() {
  const chain: Record<string, unknown> = {};
  const terminal = () =>
    Promise.resolve({ data: mockLeads, error: null, count: mockLeads.length });
  const leaf = () => chain;
  chain["in"] = leaf;
  chain["eq"] = leaf;
  chain["gte"] = leaf;
  chain["ilike"] = leaf;
  chain["lt"] = leaf;
  chain["filter"] = leaf;
  chain["order"] = leaf;
  chain["limit"] = terminal;
  chain["single"] = () =>
    Promise.resolve({ data: null, error: { code: "PGRST116" } });
  return chain;
}

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
          select: (_cols: string, _opts?: unknown) => {
            const chain = makeLeadQueryChain();
            // single() for :id lookup — check id match
            chain["eq"] = (_col: string, val: string) => {
              if (_col === "id") {
                const lead = mockLeads.find((l) => l.id === val);
                return {
                  single: async () =>
                    lead
                      ? { data: lead, error: null }
                      : { data: null, error: { code: "PGRST116" } },
                };
              }
              return makeLeadQueryChain();
            };
            return chain;
          },
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
      return {};
    },
  }),
}));

describe("GET /api/v1/leads", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
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

  it("returns 200 with valid admin token and correct shape", async () => {
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
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("next_cursor");
    expect(body).toHaveProperty("total");
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
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });

  it("CM with lead_filter contact_tier:A,B returns 200", async () => {
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
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("CM requesting tier X outside lead_filter returns empty", async () => {
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
    const body = res.json();
    // intersection of filter [A] and request [B] = empty
    expect(body.data).toEqual([]);
    await app.close();
  });

  it("rejects invalid prospect_score_gte", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?prospect_score_gte=notanumber",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
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
  });

  it("returns 401 without token", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
    });
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

  it("admin can retrieve known lead", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe("00000000-0000-0000-0000-000000000001");
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
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("CM returns 404 for lead outside their filter", async () => {
    // Lead has contact_tier=A, CM filter only allows tier C
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
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("CM returns 200 for lead inside their filter", async () => {
    // Lead has contact_tier=A, CM filter allows A
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
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
