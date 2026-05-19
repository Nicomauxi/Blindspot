import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD_ID = "00000000-0000-0000-0000-000000000001";

let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
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
  chain["order"] = leaf;
  chain["limit"] = terminal;
  chain["single"] = async () => ({ data: null, error: { code: "PGRST116" } });
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
