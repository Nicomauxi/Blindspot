import { describe, it, expect, vi, beforeEach } from "vitest";

const CAMPAIGN_ID = "cccccccc-0000-0000-0000-000000000001";
const USER_ID = "admin-user-id";

let _mockUser: Record<string, unknown> = {
  id: USER_ID,
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

const mockCampaign = {
  id: CAMPAIGN_ID,
  name: "Restaurantes Pocitos mayo 2026",
  user_id: USER_ID,
  segment_filter: { contact_tier: ["A", "B"] },
  status: "active",
  notes: null,
  created_at: "2026-05-01T00:00:00Z",
  closed_at: null,
};

const mockCampaignOutreachRows = [
  { lead_id: "lead-1", status: "contacted", outcome: null },
  { lead_id: "lead-2", status: "closed_won", outcome: "closed_won" },
];

const mockCampaignLeads = [
  { id: "lead-1", prospect_score: 40 },
  { id: "lead-2", prospect_score: 70 },
];

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
      if (table === "outreach_campaigns") {
        return {
          select: (_cols?: string) => ({
            order: () => Promise.resolve({ data: [mockCampaign], error: null }),
            eq: (_col: string, val: string) => ({
              single: async () => {
                if (val === CAMPAIGN_ID) return { data: mockCampaign, error: null };
                return { data: null, error: { code: "PGRST116" } };
              },
              order: () => Promise.resolve({ data: [mockCampaign], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: mockCampaign, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...mockCampaign, status: "closed" }, error: null }),
              }),
              then: (cb: (r: unknown) => void) => cb({ error: null }),
            }),
          }),
        };
      }
      if (table === "lead_outreach") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mockCampaignOutreachRows, error: null }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            in: async () => ({ data: mockCampaignLeads, error: null }),
          }),
        };
      }
      return {};
    },
  }),
}));

const JWT_SECRET = "test-secret-at-least-32-chars-long-1234";

describe("GET /api/v1/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = JWT_SECRET;
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("returns 401 without auth", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 with campaigns list", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });
});

describe("POST /api/v1/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = JWT_SECRET;
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("creates a campaign and returns 201", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Restaurantes Pocitos mayo 2026", segment_filter: { contact_tier: ["A"] } }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe("Restaurantes Pocitos mayo 2026");
    await app.close();
  });

  it("returns 400 when name is missing", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ segment_filter: {} }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/v1/campaigns/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = JWT_SECRET;
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("returns 200 with campaign and stats", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(CAMPAIGN_ID);
    expect(body.stats.contacted).toBe(2);
    expect(body.stats.closed_won).toBe(1);
    expect(body.stats.conversion_rate).toBe(50);
    expect(body.stats.avg_score_contacted).toBe(55);
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns/not-a-uuid",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 for unknown campaign", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /api/v1/campaigns/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = JWT_SECRET;
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("updates campaign status and returns 200", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 for invalid status value", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "unknown_status" }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("DELETE /api/v1/campaigns/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = JWT_SECRET;
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("soft-closes campaign and returns 204", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/campaigns/${CAMPAIGN_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
