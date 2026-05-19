import { describe, it, expect, vi, beforeEach } from "vitest";

let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

let _lastLlmUsageInsert: Record<string, unknown> | null = null;

const mockLead = {
  id: "00000000-0000-0000-0000-000000000001",
  contact_tier: "A",
  name: "Cafe Sur",
  niche: "restaurant",
  primary_offer: "delivery_system",
  pitch_hook: "no acepta pedidos online",
};

const mockOutreach = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  lead_id: "00000000-0000-0000-0000-000000000001",
  user_id: "admin-user-id",
  channel: "whatsapp",
  status: "contacted",
  outcome: null,
  lost_reason: null,
  created_at: "2026-01-01T00:00:00Z",
};

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
          select: () => ({
            eq: (_col: string, val: string) => ({
              single: async () => {
                if (val === mockLead.id) return { data: mockLead, error: null };
                return { data: null, error: { code: "PGRST116" } };
              },
            }),
          }),
        };
      }
      if (table === "lead_outreach") {
        return {
          select: (_cols: string, _opts?: unknown) =>
            makeOutreachChain(),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: mockOutreach, error: null }),
            }),
          }),
          update: (_payload: unknown) => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { ...mockOutreach, ...(_payload as object) },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          update: () => ({
            eq: () => ({
              is: () => Promise.resolve({ error: null }),
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
      if (table === "service_pricing") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { monthly_fee: 3500 }, error: null }),
                }),
              }),
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

function makeOutreachChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain["eq"] = () => makeOutreachChain();
  chain["lt"] = () => makeOutreachChain();
  chain["order"] = () => makeOutreachChain();
  chain["limit"] = (_n: number) =>
    Promise.resolve({ data: [mockOutreach], error: null, count: 1 });
  chain["single"] = async () => ({
    data: mockOutreach,
    error: null,
  });
  return chain;
}

describe("GET /api/v1/outreach", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _lastLlmUsageInsert = null;
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("returns 401 without auth", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/outreach" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("admin gets all outreach", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("next_cursor");
    expect(body).toHaveProperty("total");
    await app.close();
  });
});

describe("POST /api/v1/outreach", () => {
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

  it("returns 401 without auth", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/api/v1/outreach", body: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("creates outreach record with valid body", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: "00000000-0000-0000-0000-000000000001",
        channel: "whatsapp",
        status: "contacted",
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toHaveProperty("id");
    await app.close();
  });

  it("returns 400 for missing channel", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "00000000-0000-0000-0000-000000000001" }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for status/outcome mismatch (closed_won + not_now)", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: "00000000-0000-0000-0000-000000000001",
        channel: "whatsapp",
        status: "closed_won",
        outcome: "not_now",
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("outreach_status_outcome_mismatch");
    await app.close();
  });

  it("returns 400 for lost_reason on non-closed_lost status", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: "00000000-0000-0000-0000-000000000001",
        channel: "email",
        status: "contacted",
        lost_reason: "price",
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("outreach_status_outcome_mismatch");
    await app.close();
  });

  it("allows valid closed_won + closed_won outcome", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: "00000000-0000-0000-0000-000000000001",
        channel: "whatsapp",
        status: "closed_won",
        outcome: "closed_won",
      }),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("CM with null lead_filter gets 404 on create", async () => {
    _mockUser = {
      id: "cm-null",
      email: "cm@x.com",
      role: "cm",
      lead_filter: null,
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-null", email: "cm@x.com" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: "00000000-0000-0000-0000-000000000001",
        channel: "whatsapp",
      }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /api/v1/outreach/:id", () => {
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

  it("returns 401 without auth", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/outreach/aaaaaaaa-0000-0000-0000-000000000001",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 404 for invalid uuid", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/outreach/not-a-uuid",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "responded" }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("admin can update any record", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/outreach/aaaaaaaa-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "responded", responded: true }),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("CM cannot update another CM's record — 404", async () => {
    _mockUser = {
      id: "other-cm-id",
      email: "other@x.com",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "other-cm-id", email: "other@x.com" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/outreach/aaaaaaaa-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "responded" }),
    });
    // mockOutreach.user_id = "admin-user-id" ≠ "other-cm-id" → 404
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /api/v1/outreach/generate-offer", () => {
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

  it("returns offer for valid lead_id using template fallback", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach/generate-offer",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "00000000-0000-0000-0000-000000000001", channel: "whatsapp" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty("text");
    expect(typeof body.data.text).toBe("string");
    expect(body.data.text.length).toBeGreaterThan(0);
    expect(body.data.source_llm).toBe("template");
    expect(body.data.text).toContain("UYU 3.500");
    expect(_lastLlmUsageInsert).toEqual(
      expect.objectContaining({
        operation: "generate_offer",
        provider: "template",
        model: "template-v1",
        lead_id: mockLead.id,
        user_id: "admin-user-id",
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        success: true,
        error: null,
      })
    );
    await app.close();
  });

  it("returns 400 without lead_id", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outreach/generate-offer",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
