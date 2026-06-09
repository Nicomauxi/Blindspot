import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  caps: Row;
  snapshot: { cpu: { pct: number }; ram: { pct: number } };
  jobState: Record<string, unknown>;
} = {
  user: { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null },
  caps: { max_cpu_pct: 80, max_ram_pct: 80 },
  snapshot: { cpu: { pct: 10 }, ram: { pct: 40 } },
  jobState: { running: false, pid: null, started_at: null, log_file: null, limit: null, force: null },
};

const { launchSocialEnrichJob } = vi.hoisted(() => ({ launchSocialEnrichJob: vi.fn() }));

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.user, error: null }) }) }) };
      }
      if (table === "pipeline_config") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.caps, error: null }) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

vi.mock("../../api/src/modules/monitoring/resources.js", () => ({
  buildResourceSnapshot: vi.fn(async () => state.snapshot),
}));

vi.mock("../../api/src/modules/social-enrich/launcher.js", () => ({
  getSocialEnrichJobState: vi.fn(() => state.jobState),
  launchSocialEnrichJob,
}));

function adminToken(app: Awaited<ReturnType<typeof buildServer>>): string {
  return app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });
}

describe("Social-enrich aislado (F2-ext Fase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.caps = { max_cpu_pct: 80, max_ram_pct: 80 };
    state.snapshot = { cpu: { pct: 10 }, ram: { pct: 40 } };
    state.jobState = { running: false, pid: null, started_at: null, log_file: null, limit: null, force: null };
    launchSocialEnrichJob.mockReturnValue({
      running: true, pid: 4242, started_at: "2026-06-09T20:00:00.000Z",
      log_file: "/tmp/social.log", limit: 500, force: true,
    });
  });

  it("POST lanza el subproceso con limit/force y devuelve 202", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/social-enrich/jobs",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: 500, force: true }),
    });
    expect(res.statusCode).toBe(202);
    expect(launchSocialEnrichJob).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500, force: true })
    );
    expect(res.json().data).toMatchObject({ running: true, pid: 4242 });
  });

  it("POST aplica el resource guard: 429 si CPU o RAM superan los caps", async () => {
    state.snapshot = { cpu: { pct: 92 }, ram: { pct: 40 } };
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/social-enrich/jobs",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error_code).toBe("resources_exceeded");
    expect(launchSocialEnrichJob).not.toHaveBeenCalled();
  });

  it("POST devuelve 409 si ya hay un subproceso corriendo", async () => {
    state.jobState = { running: true, pid: 999, started_at: "x", log_file: "y", limit: 100, force: false };
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/social-enrich/jobs",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("already_running");
    expect(launchSocialEnrichJob).not.toHaveBeenCalled();
  });

  it("POST valida el límite (1..8000)", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/social-enrich/jobs",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: 0 }),
    });
    expect(res.statusCode).toBe(400);
    expect(launchSocialEnrichJob).not.toHaveBeenCalled();
  });

  it("GET current devuelve el estado del subproceso", async () => {
    state.jobState = { running: true, pid: 777, started_at: "z", log_file: "w", limit: 50, force: false };
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/social-enrich/jobs/current",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ running: true, pid: 777 });
  });
});
