import { beforeEach, describe, expect, it, vi } from "vitest";

let _authUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

let _targetUser: Record<string, unknown> = {
  id: "target-user-id",
  email: "target@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

let _historyBlockers: Record<string, boolean> = {
  lead_outreach: false,
  audit_log: false,
  service_pricing: false,
  outreach_campaigns: false,
  discovery_jobs: false,
  llm_usage_log: false,
};

let _rpcCalls: Array<{ fn: string; args: unknown }> = [];

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    rpc: async (fn: string, args: unknown) => {
      _rpcCalls.push({ fn, args });
      return { data: 1, error: null };
    },
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: (_column: string, id: unknown) => ({
              single: async () => {
                if (id === _authUser.id) return { data: _authUser, error: null };
                if (id === _targetUser.id) return { data: _targetUser, error: null };
                return { data: null, error: { code: "PGRST116" } };
              },
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "new-user-id",
                  email: "new@blindspot.local",
                  role: "cm",
                  lead_filter: { contact_tier: ["A"] },
                  active: true,
                },
                error: null,
              }),
            }),
          }),
          update: (_payload: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { ..._targetUser, ..._payload, updated_at: "2026-01-01T00:00:00Z" },
                  error: null,
                }),
              }),
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }

      if (table === "audit_log") {
        return {
          insert: async () => ({ error: null }),
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: _historyBlockers.audit_log ? [{ id: "history-row" }] : [],
                error: null,
              }),
            }),
          }),
        };
      }

      if (
        table === "lead_outreach" ||
        table === "service_pricing" ||
        table === "outreach_campaigns" ||
        table === "discovery_jobs" ||
        table === "llm_usage_log" ||
        // N28: FKs CRM agregados a los historyChecks
        table === "lead_tracking" ||
        table === "lead_feedback" ||
        table === "discovery_job_batches" ||
        table === "leads"
      ) {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: _historyBlockers[table] ? [{ id: `${table}-row` }] : [],
                error: null,
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

describe("users route RBAC and validation", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _authUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
    _targetUser = {
      id: "target-user-id",
      email: "target@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
    _historyBlockers = {
      lead_outreach: false,
      audit_log: false,
      service_pricing: false,
      outreach_campaigns: false,
      discovery_jobs: false,
      llm_usage_log: false,
    };
    _rpcCalls = [];
  });

  it("MA-01: PATCH password resetea token_version (revoca sesiones vigentes)", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/target-user-id",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: "a-brand-new-password-123" }),
    });

    expect(res.statusCode).toBe(200);
    expect(_rpcCalls).toContainEqual({
      fn: "bump_user_token_version",
      args: { p_user_id: "target-user-id" },
    });
    await app.close();
  });

  it("MA-01: un PATCH sin password NO bumpea token_version", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/target-user-id",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });

    expect(res.statusCode).toBe(200);
    expect(_rpcCalls.some((c) => c.fn === "bump_user_token_version")).toBe(false);
    await app.close();
  });

  it("POST /users rejects passwords shorter than 12 chars", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "short@blindspot.local",
        password: "shortpass11",
        role: "cm",
        lead_filter: { contact_tier: ["A"] },
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("validation_error");
    await app.close();
  });

  it("PATCH /users/:id does not allow degrading a CM to invalid null lead_filter", async () => {
    _targetUser = {
      id: "target-user-id",
      email: "target@blindspot.local",
      role: "cm",
      lead_filter: { contact_tier: ["A"] },
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${_targetUser.id}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_filter: null }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("lead_filter_required");
    await app.close();
  });

  it("PATCH /users/:id role=cm requires a valid resulting lead_filter", async () => {
    _targetUser = {
      id: "target-user-id",
      email: "target@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${_targetUser.id}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "cm" }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("lead_filter_required");
    await app.close();
  });

  it("DELETE /users/:id returns 409 user_has_history when related rows exist", async () => {
    _historyBlockers = {
      ..._historyBlockers,
      lead_outreach: true,
      audit_log: true,
    };

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${_targetUser.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(
      expect.objectContaining({
        error_code: "user_has_history",
        blockers: expect.arrayContaining(["lead_outreach", "audit_log"]),
      })
    );
    await app.close();
  });
});
