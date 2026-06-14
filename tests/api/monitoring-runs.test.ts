import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  pipelineRuns: Row[];
  runs: Row[];
  discoveryJobs: Row[];
} = {
  user: { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null },
  pipelineRuns: [],
  runs: [],
  discoveryJobs: [],
};

function thenableChain(rows: () => Row[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return chain;
}

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.user, error: null }) }) }) };
      }
      if (table === "pipeline_runs") return thenableChain(() => state.pipelineRuns);
      if (table === "runs") return thenableChain(() => state.runs);
      if (table === "discovery_jobs") return thenableChain(() => state.discoveryJobs);
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function adminToken(app: Awaited<ReturnType<typeof buildServer>>): string {
  return app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });
}

describe("GET /admin/monitoring/runs — lista unificada", () => {
  beforeEach(() => {
    state.pipelineRuns = [
      {
        id: "pr-1", status: "completed", triggered_by: "cron",
        created_at: "2026-06-09T10:00:00Z", started_at: "2026-06-09T10:00:05Z", completed_at: "2026-06-09T10:30:00Z",
        phase_results: { discovery: { status: "completed" } },
      },
    ];
    state.runs = [
      {
        id: "run-enr-1", kind: "enrichment", status: "running",
        started_at: "2026-06-09T11:00:00Z", finished_at: null,
        niche: "__enrichment_filter__", location: "__enrichment_filter__",
        config: { command: "enrich", mode: "filter" }, stats: null,
      },
      {
        id: "run-sco-1", kind: "scoring", status: "completed",
        started_at: "2026-06-09T11:20:00Z", finished_at: "2026-06-09T11:25:00Z",
        niche: "restaurante", location: "Montevideo",
        config: { command: "score", scope: "run", source_run_id: "run-enr-1" },
        stats: { leads_scored: 42 },
      },
    ];
    state.discoveryJobs = [
      {
        id: "dj-1", source: "yelu", location: "Montevideo", niche: "restaurante",
        status: "queued", created_at: "2026-06-09T12:00:00Z", started_at: null, completed_at: null,
      },
    ];
  });

  it("devuelve runs de las tres fuentes normalizados y ordenados desc", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/runs",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data as Array<Row>;
    expect(items.map((i) => i["id"])).toEqual(["dj-1", "run-sco-1", "run-enr-1", "pr-1"]);

    const pipeline = items.find((i) => i["id"] === "pr-1")!;
    expect(pipeline).toMatchObject({ kind: "pipeline", status: "completed", finished_at: "2026-06-09T10:30:00Z" });
    expect(pipeline["phases"]).toBeTruthy();

    const discovery = items.find((i) => i["id"] === "dj-1")!;
    expect(discovery).toMatchObject({ kind: "discovery", status: "queued" });
    expect(discovery["label"]).toContain("yelu");
  });

  it("limpia sentinels del label y expone el encadenamiento por source_run_id", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/runs",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    const items = res.json().data as Array<Row>;

    const enrich = items.find((i) => i["id"] === "run-enr-1")!;
    // El sentinel __enrichment_filter__ no debe filtrarse al label visible.
    expect(String(enrich["label"] ?? "")).not.toContain("__");

    const scoring = items.find((i) => i["id"] === "run-sco-1")!;
    expect(scoring).toMatchObject({ kind: "scoring", source_run_id: "run-enr-1" });
    expect(scoring["progress"]).toMatchObject({ leads_scored: 42 });
  });

  it("filtra por tipo (uno o varios separados por coma)", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/runs?type=scoring,discovery",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data as Array<Row>;
    expect(items.map((i) => i["kind"]).sort()).toEqual(["discovery", "scoring"]);
  });

  it("rechaza tipos desconocidos con 400", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/runs?type=banana",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("respeta el límite", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/runs?limit=2",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    const items = res.json().data as Array<Row>;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i["id"])).toEqual(["dj-1", "run-sco-1"]);
  });
});
