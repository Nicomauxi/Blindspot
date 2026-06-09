import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  config: Row;
  lastUpdate: Row | null;
} = {
  user: { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null },
  config: {},
  lastUpdate: null,
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.user, error: null }) }) }) };
      }
      if (table === "pipeline_config") {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: state.config, error: null }) }) }),
          update: (payload: Row) => {
            state.lastUpdate = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function adminToken(app: Awaited<ReturnType<typeof buildServer>>): string {
  return app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });
}

function baseConfig(): Row {
  return {
    enabled: true,
    cron_expression: "0 2 * * 0",
    phases: { discovery: { max_jobs: 10 } },
    google_places_budget_total: 200,
    google_places_alert_threshold: 10,
    notify_webhook_url: null,
    notify_webhook_secret: null,
    notify_webhook_events: [],
    max_concurrent_runs: 1,
    max_cpu_pct: 80,
    max_ram_pct: 80,
    max_enrich_threads: 4,
    fetch_timeout_ms: 8000,
    fetch_retries: 2,
    enrich_heuristic_max_concurrency: 2,
  };
}

describe("Variables — knobs de velocidad (F2-ext Fase 4)", () => {
  beforeEach(() => {
    state.user = { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null };
    state.config = baseConfig();
    state.lastUpdate = null;
  });

  it("GET /admin/variables lista los knobs de velocidad con sus valores", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/variables",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data as Array<{ key: string; value: unknown; type: string }>;
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get("fetch_timeout_ms")).toMatchObject({ type: "number", value: 8000 });
    expect(byKey.get("fetch_retries")).toMatchObject({ type: "number", value: 2 });
    expect(byKey.get("enrich_heuristic_max_concurrency")).toMatchObject({ type: "number", value: 2 });
  });

  it("PATCH fetch_timeout_ms válido persiste en pipeline_config", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/variables/fetch_timeout_ms",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ value: 5000 }),
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({ fetch_timeout_ms: 5000 });
  });

  it("PATCH fetch_timeout_ms fuera de rango (≥1000) devuelve 400", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/variables/fetch_timeout_ms",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ value: 100 }),
    });
    expect(res.statusCode).toBe(400);
    expect(state.lastUpdate).toBeNull();
  });

  it("PATCH fetch_retries fuera de rango (≤3) devuelve 400", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/variables/fetch_retries",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.statusCode).toBe(400);
    expect(state.lastUpdate).toBeNull();
  });

  it("PATCH enrich_heuristic_max_concurrency fuera de rango (≤32) devuelve 400", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/variables/enrich_heuristic_max_concurrency",
      headers: { authorization: `Bearer ${adminToken(app)}`, "content-type": "application/json" },
      body: JSON.stringify({ value: 40 }),
    });
    expect(res.statusCode).toBe(400);
    expect(state.lastUpdate).toBeNull();
  });
});
