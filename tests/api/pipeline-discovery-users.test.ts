import { describe, it, expect, vi, beforeEach } from "vitest";

let _activePipelineRun: Record<string, unknown> | null = null;

let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              single: async () => ({ data: _mockUser, error: null }),
              lt: () => ({ order: () => ({ limit: (_n: number) => Promise.resolve({ data: [_mockUser], error: null, count: 1 }) }) }),
            }),
            order: () => ({ limit: (_n: number) => Promise.resolve({ data: [_mockUser], error: null, count: 1 }) }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-user-id", email: "new@x.com", role: "cm", active: true, created_at: "2026-01-01T00:00:00Z" },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...(_mockUser as object), updated_at: "2026-01-01T00:00:00Z" }, error: null }),
              }),
            }),
          }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
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
                  google_places_budget_total: 200,
                  google_places_budget_spent: 40,
                  google_places_alert_threshold: 10,
                },
                error: null,
              }),
            }),
            limit: () => ({
              single: async () => ({
                data: {
                  id: "singleton",
                  enabled: false,
                  cron_expression: "0 2 * * 0",
                  scheduled_for: null,
                  last_completed_at: null,
                  google_places_budget_total: 200,
                  google_places_budget_spent: 40,
                  google_places_alert_threshold: 10,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "singleton", enabled: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "pipeline_runs") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) =>
                Promise.resolve({ data: [], error: null, count: 0 }),
              maybeSingle: async () => ({ data: null }),
            }),
            eq: (_c: string, _v: unknown) => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
              limit: (_n: number) => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
            in: (_c: string, values: unknown[]) => ({
              limit: (_n: number) => ({
                maybeSingle: async () => ({
                  data: _activePipelineRun && values.includes(_activePipelineRun["status"]) ? _activePipelineRun : null,
                }),
              }),
              order: () => ({
                limit: (_n: number) =>
                  Promise.resolve({ data: [], error: null, count: 0 }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-run-id", status: "pending" },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "discovery_jobs") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: [
                  {
                    id: "legacy-job-id",
                    batch_id: null,
                    source: "yelu",
                    location: "Montevideo",
                    niche: "restaurant",
                    status: "queued",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
                count: 1,
              }),
            }),
            eq: () => ({
              single: async () => ({ data: { id: "job-id", status: "queued", batch_id: null }, error: null }),
              in: async () => ({ error: null }),
            }),
            in: () => ({
              order: () => Promise.resolve({
                data: [
                  {
                    id: "child-job-id",
                    batch_id: "batch-1",
                    source: "yelu",
                    location: "Montevideo",
                    niche: "restaurant",
                    status: "queued",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
              }),
            }),
            limit: (_n: number) => Promise.resolve({
              data: [
                { source: "yelu", niche: "restaurant", location: "Montevideo", created_at: "2026-05-20T10:00:00Z" },
              ],
              error: null,
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-job-id", status: "queued", batch_id: null },
                error: null,
              }),
            }),
            then: (cb: (value: unknown) => void) => cb({ data: [], error: null }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "job-id", status: "paused", batch_id: null },
                  error: null,
                }),
              }),
              in: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "discovery_job_batches") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: [
                  {
                    id: "batch-1",
                    location: "Montevideo",
                    location_key: "montevideo",
                    niche: "restaurant",
                    sources: ["yelu", "osm"],
                    estimated_cost_usd: 0,
                    actual_cost_usd: 0,
                    status: "queued",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
                count: 1,
              }),
            }),
            eq: () => ({
              single: async () => ({ data: { id: "batch-1" }, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "batch-1", location: "Montevideo", location_key: "montevideo", niche: "restaurant", sources: ["yelu", "osm"], status: "queued", created_at: "2026-05-20T10:00:00Z" },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: [
                  {
                    id: "lead-1",
                    source: "yelu",
                    niche: "restaurant",
                    address: "Montevideo, Uruguay",
                    prospect_score: 70,
                    gps: { lat: -34.9, lng: -56.2 },
                    corroborating_sources: [{ source: "osm" }],
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "runs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: (_n: number) => Promise.resolve({
                  data: [{ finished_at: "2026-05-20T10:00:00Z", stats: { estimated_cost_usd: 2.5 } }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "outreach_campaigns") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            eq: (_col: string, _val: string) => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "not used in this test" } }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ single: async () => ({ data: null, error: null }) }),
              then: (cb: (r: unknown) => void) => cb({ error: null }),
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) =>
                Promise.resolve({ data: [], error: null, count: 0 }),
            }),
            eq: () => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

describe("Pipeline routes — admin only", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _activePipelineRun = null;
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("GET /pipeline/config returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /pipeline/config returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("POST /pipeline/run returns 202 with run_id", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toHaveProperty("run_id");
    await app.close();
  });

  it("POST /pipeline/run blocks when a pending run already exists", async () => {
    _activePipelineRun = { id: "pending-run-id", status: "pending" };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("run_already_active");
    await app.close();
  });

  it("POST /pipeline/abort aborts a pending run too", async () => {
    _activePipelineRun = { id: "pending-run-id", status: "pending" };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/abort",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ run_id: "pending-run-id", abort_requested: true });
    await app.close();
  });

  it("POST /pipeline/run accepts dry_run and still queues a run", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.run_id).toBeDefined();
    expect(body.data.dry_run).toBe(true);
    await app.close();
  });

  it("GET /pipeline/runs returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("Discovery routes", () => {
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

  it("POST /discovery/jobs returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "yelu", location: "Montevideo" }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /discovery/jobs returns 201 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "yelu", location: "Montevideo", niche: "restaurant" }),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("GET /discovery/suggestions returns real recommendation payload", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/suggestions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.coverage_gaps_global)).toBe(true);
    expect(Array.isArray(body.data.location_density)).toBe(true);
    await app.close();
  });

  it("GET /discovery/coverage returns grouped coverage data", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/coverage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.coverage_gaps_global)).toBe(true);
    expect(Array.isArray(body.data.supported_sources)).toBe(true);
    await app.close();
  });
});

describe("Campaigns routes — implemented (Fase 43)", () => {
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

  it("GET /campaigns returns 200 with data array", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });
});

describe("Users routes — admin only", () => {
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

  it("GET /users returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /users with CM role and null lead_filter returns 400 lead_filter_required", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: null,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_required");
    await app.close();
  });

  it("POST /users with CM role and empty lead_filter without ack returns 400", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: {},
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_empty_requires_ack");
    await app.close();
  });

  it("POST /users with CM + empty lead_filter + acknowledge_unrestricted returns 201", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: {},
        acknowledge_unrestricted: true,
      }),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("POST /users with CM + empty array in lead_filter returns 400 lead_filter_array_empty", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: { contact_tier: [] },
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_array_empty");
    await app.close();
  });
});

describe("Admin audit-log route", () => {
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

  it("GET /admin/audit-log returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-log",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /admin/audit-log returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-log",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
