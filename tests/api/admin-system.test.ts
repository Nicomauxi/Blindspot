import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  pipelineConfig: Row | null;
  lastRun: Row | null;
  auditInserts: Row[];
} = {
  user: {
    id: "admin-id",
    email: "admin@test.local",
    role: "admin",
    active: true,
    lead_filter: null,
  },
  pipelineConfig: {
    id: "singleton",
    enabled: true,
    scheduled_for: "2026-05-20T02:00:00Z",
    last_completed_at: "2026-05-18T01:00:00Z",
  },
  lastRun: {
    id: "run-1",
    status: "completed",
    completed_at: "2026-05-18T01:00:00Z",
    created_at: "2026-05-18T00:00:00Z",
    dashboard_stale: false,
  },
  auditInserts: [],
};

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.user, error: null }),
            }),
          }),
        };
      }

      if (table === "pipeline_config") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.pipelineConfig, error: null }),
            }),
          }),
        };
      }

      if (table === "pipeline_runs") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: state.lastRun ? [state.lastRun] : [], error: null }),
              maybeSingle: async () => ({ data: state.lastRun, error: null }),
            }),
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "discovery_jobs") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }

      if (table === "audit_log") {
        return {
          insert: async (row: Row) => {
            state.auditInserts.push(row);
            return { error: null };
          },
        };
      }

      return {};
    },
  }),
}));

describe("GET/POST /api/v1/admin/system/*", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    process.env["NODE_ENV"] = "development";
    execFileMock.mockReset();
    state.auditInserts = [];
  });

  it("returns admin system status with process metadata", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/system/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.server.version).toBeDefined();
    expect(body.data.db).toMatchObject({ connected: true });
    expect(body.data.pipeline).toMatchObject({
      cron_enabled: true,
      last_status: "completed",
    });
    expect(body.data.processes.api).toMatchObject({
      running: true,
      pid: expect.any(Number),
    });
  });

  it("returns typed 501 in dev for restart endpoints", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/system/restart-core",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({
      ok: false,
      error_code: "restart_disabled_in_dev",
      exit_code: null,
    });
    expect(state.auditInserts).toHaveLength(0);
  });

  it("restarts core in production and writes audit log first", async () => {
    process.env["NODE_ENV"] = "production";
    execFileMock.mockImplementation((command: string, args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      expect(command).toBe("pm2");
      if (args[0] === "jlist") {
        callback(null, JSON.stringify([
          { name: "core", pid: 1234, pm2_env: { status: "online", pm_uptime: Date.now() - 60_000 } },
          { name: "api", pid: 5678, pm2_env: { status: "online", pm_uptime: Date.now() - 120_000 } },
        ]), "");
        return;
      }

      callback(null, "ok", "");
    });

    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/system/restart-core",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, exit_code: 0 });
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]).toMatchObject({
      action: "system.restart",
      target_type: "system",
      target_id: "core",
      actor_user_id: "admin-id",
    });
  });
});
