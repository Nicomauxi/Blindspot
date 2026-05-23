/**
 * Fase API APIE — Auth matrix integration tests
 * Verifies: live lead_filter updates, active=false immediate block,
 * admin-only path enforcement, and cross-cutting auth invariants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// DB state that can be mutated between requests to simulate live updates
const _db: {
  user: Record<string, unknown>;
  leads: Array<Record<string, unknown>>;
} = {
  user: {
    id: "cm-live-id",
    email: "cm@live.test",
    role: "cm",
    lead_filter: { contact_tier: ["A"] },
    active: true,
  },
  leads: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Lead A",
      contact_tier: "A",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Lead B",
      contact_tier: "B",
      created_at: "2026-01-02T00:00:00Z",
    },
  ],
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: _db.user, error: null }),
            }),
          }),
        };
      }
      if (table === "lead_dashboard") {
        return {
          select: (_cols: string, _opts?: unknown) => {
            const chain = makeLiveDashboardChain();
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

function makeLiveDashboardChain() {
  const chain: Record<string, unknown> = {};

  const applyFiltersAndReturn = () => {
    const ordered: Record<string, unknown> = {};
    ordered["order"] = () => ordered;
    ordered["limit"] = (_n: number) => {
      const filter = _db.user["lead_filter"] as Record<string, unknown> | null;
      let rows = _db.leads;
      if (filter) {
        const tiers = filter["contact_tier"] as string[] | undefined;
        if (Array.isArray(tiers) && tiers.length > 0) {
          rows = rows.filter((l) => tiers.includes(l["contact_tier"] as string));
        }
      }
      return Promise.resolve({ data: rows.slice(0, _n - 1), error: null, count: rows.length });
    };
    return ordered;
  };

  chain["in"] = (_col: string, _vals: string[]) => applyFiltersAndReturn();
  chain["eq"] = (_col: string, val: string) => ({
    single: async () => {
      const lead = _db.leads.find((l) => l["id"] === val);
      return lead ? { data: lead, error: null } : { data: null, error: { code: "PGRST116" } };
    },
  });
  chain["filter"] = () => chain;
  return chain;
}

describe("APIE — Auth matrix invariants", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    // Reset DB state
    _db.user = {
      id: "cm-live-id",
      email: "cm@live.test",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };
  });

  it("live lead_filter update: same JWT sees different results after DB change", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });

    // First request — filter allows tier A only → 1 lead
    const res1 = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    const tiers1 = (body1.data as Array<Record<string, unknown>>).map((l) => l["contact_tier"]);
    expect(tiers1.every((t) => t === "A")).toBe(true);

    // Admin updates lead_filter to allow tier B (simulated via _db mutation)
    _db.user = { ..._db.user, lead_filter: { contact_tier: ["B"] } };

    // Second request — SAME JWT, different result because we load from DB each time
    const res2 = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    const tiers2 = (body2.data as Array<Record<string, unknown>>).map((l) => l["contact_tier"]);
    expect(tiers2.every((t) => t === "B")).toBe(true);

    await app.close();
  });

  it("active=false blocks user immediately without re-login", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });

    // First request — active, works
    const res1 = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res1.statusCode).toBe(200);

    // Admin deactivates user — SAME JWT in next request
    _db.user = { ..._db.user, active: false };

    const res2 = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res2.statusCode).toBe(401);
    const body = res2.json();
    expect(body.error_code).toBe("account_inactive");

    await app.close();
  });

  it("CM cannot access /users — 403", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("CM cannot access PUT /pipeline/config — 403", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("CM cannot access /admin/audit-log — 403", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-log",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("CM with null lead_filter sees empty leads on GET /leads", async () => {
    _db.user = { ..._db.user, lead_filter: null };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
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

  it("CM intersection: filter=[A], request contact_tier=B returns empty", async () => {
    _db.user = { ..._db.user, lead_filter: { contact_tier: ["A"] } };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads?contact_tier=B",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    await app.close();
  });

  it("GET /leads/:id returns 404 for lead outside CM filter", async () => {
    // Lead 1 has tier A, filter allows only B
    _db.user = { ..._db.user, lead_filter: { contact_tier: ["B"] } };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-live-id", email: "cm@live.test" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/00000000-0000-0000-0000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
