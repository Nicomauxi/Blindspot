import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  pipelineConfig: Row | null;
  llmRows: Row[];
  runs: Row[];
  leads: Row[];
} = {
  user: {
    id: "admin-id",
    email: "admin@test.local",
    role: "admin",
    active: true,
    lead_filter: null,
  },
  pipelineConfig: {
    google_places_budget_total: 200,
    google_places_budget_spent: 5.16,
    google_places_alert_threshold: 10,
    infra_monthly_cost_usd: 30,
    backup_monthly_cost_usd: 5,
  },
  llmRows: [],
  runs: [],
  leads: [],
};


function rangeChain(rows: () => Array<Record<string, unknown>>) {
  // Soporta .gte().lt().order().range() y .limit() — filtra por fecha como PostgREST.
  const makeChain = (filters: Array<(r: Record<string, unknown>) => boolean>) => {
    const apply = () => rows().filter((r) => filters.every((f) => f(r)));
    const chain: Record<string, unknown> = {};
    chain["gte"] = (col: string, val: string) => makeChain([...filters, (r) => String(r[col] ?? "") >= val]);
    chain["lt"] = (col: string, val: string) => makeChain([...filters, (r) => String(r[col] ?? "") < val]);
    chain["eq"] = (col: string, val: unknown) => makeChain([...filters, (r) => r[col] === val]);
    chain["order"] = () => chain;
    chain["range"] = async (from: number, to: number) => ({ data: apply().slice(from, to + 1), error: null });
    chain["limit"] = async (n: number) => ({ data: apply().slice(0, n), error: null });
    return chain;
  };
  return makeChain([]);
}

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
            limit: () => ({
              single: async () => ({ data: state.pipelineConfig, error: null }),
            }),
            single: async () => ({ data: state.pipelineConfig, error: null }),
          }),
        };
      }

      if (table === "llm_usage_log") {
        return { select: () => rangeChain(() => state.llmRows) };
      }

      if (table === "runs") {
        return { select: () => rangeChain(() => state.runs) };
      }

      if (table === "leads") {
        return { select: () => rangeChain(() => state.leads) };
      }

      return {};
    },
  }),
}));

describe("GET /api/v1/admin/costs/*", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";

    state.user = {
      id: "admin-id",
      email: "admin@test.local",
      role: "admin",
      active: true,
      lead_filter: null,
    };

    state.pipelineConfig = {
      google_places_budget_total: 200,
      google_places_budget_spent: 5.16,
      google_places_alert_threshold: 10,
      infra_monthly_cost_usd: 30,
      backup_monthly_cost_usd: 5,
    };

    state.llmRows = [
      {
        provider: "gemini",
        model: "gemini-2.5-pro",
        operation: "generate_offer",
        lead_id: "lead-1",
        total_tokens: 1200,
        cost_usd: 0.4,
        created_at: "2026-05-10T10:00:00Z",
      },
      {
        provider: "openai-compatible",
        model: "llama",
        operation: "detect_sub_niche",
        lead_id: "lead-2",
        total_tokens: 600,
        cost_usd: 0.2,
        created_at: "2026-05-11T09:00:00Z",
      },
      {
        provider: "gemini",
        model: "gemini-2.5-pro",
        operation: "generate_offer",
        lead_id: "lead-1",
        total_tokens: 400,
        cost_usd: 0.1,
        created_at: "2026-05-12T09:00:00Z",
      },
      {
        provider: "gemini",
        model: "gemini-2.5-pro",
        operation: "generate_offer",
        lead_id: "lead-4",
        total_tokens: 300,
        cost_usd: 0.3,
        created_at: "2026-04-05T09:00:00Z",
      },
    ];

    state.runs = [
      {
        id: "run-1",
        niche: "restaurant",
        location: "Montevideo",
        status: "completed",
        stats: { estimated_cost_usd: 0.9, places_requests: 45 },
        finished_at: "2026-05-03T08:00:00Z",
      },
      {
        id: "run-2",
        niche: "hotel",
        location: "Punta del Este",
        status: "completed",
        stats: { estimated_cost_usd: 0.5, places_requests: 20 },
        finished_at: "2026-04-02T08:00:00Z",
      },
    ];

    state.leads = [
      {
        id: "lead-1",
        name: "Cafe Sur",
        source: "google_places",
        first_seen_run_id: "run-1",
        created_at: "2026-05-03T09:00:00Z",
        prospect_score: 60,
      },
      {
        id: "lead-2",
        name: "Hotel Centro",
        source: "mintur",
        first_seen_run_id: null,
        created_at: "2026-05-10T09:00:00Z",
        prospect_score: 40,
      },
      {
        id: "lead-3",
        name: "Panaderia Norte",
        source: "google_places",
        first_seen_run_id: "run-1",
        created_at: "2026-05-04T09:00:00Z",
        prospect_score: 80,
      },
      {
        id: "lead-4",
        name: "Optica Este",
        source: "google_places",
        first_seen_run_id: "run-2",
        created_at: "2026-04-07T09:00:00Z",
        prospect_score: 58,
      },
    ];
  });

  it("returns monthly overview with totals, per-source breakdown and top leads", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/costs/overview?month=2026-05",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.month).toBe("2026-05");
    expect(body.data.totals).toMatchObject({
      llm_usd: 0.7,
      google_places_usd: 0.9,
      infra_usd: 30,
      backup_usd: 5,
      total_usd: 36.6,
    });
    expect(body.data.google_places).toMatchObject({
      budget_total: 200,
      budget_spent: 5.16,
      budget_remaining: 194.84,
      alert_threshold: 10,
      request_count: 45,
      over_alert: false,
    });
    expect(body.data.per_lead).toMatchObject({
      hot_leads_count: 2,
      total_cost_usd: 1.6,
      cost_per_hot_usd: 0.8,
    });
    expect(body.data.per_lead.top_leads[0]).toMatchObject({
      lead_id: "lead-1",
      name: "Cafe Sur",
      llm_cost_usd: 0.5,
      gp_cost_share_usd: 0.45,
      total_cost_usd: 0.95,
    });
    expect(body.data.per_source).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "google_places", cost_usd: 0.9, leads_count: 2 }),
        expect.objectContaining({ source: "mintur", cost_usd: 0, leads_count: 1 }),
        expect.objectContaining({ source: "gemini", cost_usd: 0.5, leads_count: 1 }),
        expect.objectContaining({ source: "openai-compatible", cost_usd: 0.2, leads_count: 1 }),
        expect.objectContaining({ source: "infra", cost_usd: 30, leads_count: 0 }),
        expect.objectContaining({ source: "backup", cost_usd: 5, leads_count: 0 }),
      ])
    );

    await app.close();
  });

  it("returns 12-month history with trend totals and hot leads", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/costs/history",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.monthly).toHaveLength(12);
    expect(body.data.monthly[0]).toMatchObject({
      month: "2026-05",
      google_places_usd: 0.9,
      llm_usd: 0.7,
      infra_usd: 30,
      backup_usd: 5,
      total_usd: 36.6,
      hot_leads: 2,
    });
    expect(body.data.monthly[1]).toMatchObject({
      month: "2026-04",
      google_places_usd: 0.5,
      llm_usd: 0.3,
      infra_usd: 30,
      backup_usd: 5,
      total_usd: 35.8,
      hot_leads: 1,
    });

    await app.close();
  });
});
