import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  pipelineConfig: Row | null;
  pipelineRuns: Row[];
  activeRun: Row | null;
  discoveryJobs: Row[];
  llmRows: Row[];
  costRuns: Row[];
  pipelineErrors: Row[];
} = {
  user: {
    id: "admin-id",
    email: "admin@test.local",
    role: "admin",
    active: true,
    lead_filter: null,
  },
  pipelineConfig: null,
  pipelineRuns: [],
  activeRun: null,
  discoveryJobs: [],
  llmRows: [],
  costRuns: [],
  pipelineErrors: [],
};

vi.mock("../../api/src/modules/backups/runtime.js", () => ({
  getBackupScheduler: () => ({
    getSnapshot: () => ({ status: "idle" }),
  }),
}));

vi.mock("../../api/src/modules/backups/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/src/modules/backups/service.js")>();
  return {
    ...actual,
    getDefaultBackupSchedulerSnapshot: () => ({ status: "idle" }),
    buildBackupOverview: async () => ({
    config: {
      enabled: true,
      cron_expression: "0 3 * * *",
      effective_directory: "/tmp/backups",
      directory_valid: true,
      max_backups: 7,
      max_manual_backups: 7,
      max_scheduled_backups: 7,
      maintenance_mode: false,
    },
    scheduler: {
      started: true,
      cron_active: true,
      status: "scheduled",
      last_reload_at: null,
      last_tick_at: "2026-05-18T10:00:00Z",
      last_error_at: null,
      last_error_message: null,
    },
    summary: {
      last_backup: { id: "backup-1", status: "completed", created_at: "2026-05-18T09:00:00Z", completed_at: "2026-05-18T09:10:00Z" },
      next_backup_at: "2026-05-19T03:00:00Z",
      backup_count: 4,
      max_backups: 7,
      manual_backup_count: 3,
      scheduled_backup_count: 1,
      restore_checkpoint_count: 1,
      retention: {
        manual: { count: 3, max: 7 },
        scheduled: { count: 1, max: 7 },
      },
      database_size_bytes: 73400320,
      stored_backup_size_bytes: 245760,
      stored_backup_size_by_trigger: { manual: 163840, scheduled: 81920 },
      last_restore: null,
    },
    restore: { active: null, last_restore: null },
    recent: [],
    alerts: [],
  }),
  };
});

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
              limit: async (n: number) => ({ data: state.pipelineRuns.slice(0, n), error: null }),
              maybeSingle: async () => ({ data: state.activeRun, error: null }),
            }),
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: state.activeRun, error: null }),
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
              limit: async (n: number) => ({ data: state.discoveryJobs.slice(0, n), error: null }),
            }),
            // Conteos exactos por estado: .select("*", {count}).eq("status", X)
            eq: (_col: string, status: string) => ({
              count: state.discoveryJobs.filter((j) => j.status === status).length,
              error: null,
              then: (resolve: (v: { count: number; error: null }) => unknown) =>
                resolve({ count: state.discoveryJobs.filter((j) => j.status === status).length, error: null }),
            }),
          }),
        };
      }

      if (table === "llm_usage_log") {
        return {
          select: () => ({
            order: () => ({
              limit: async (n: number) => ({ data: state.llmRows.slice(0, n), error: null }),
            }),
          }),
        };
      }

      if (table === "runs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async (n: number) => ({ data: state.costRuns.slice(0, n), error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "pipeline_errors") {
        return {
          select: () => ({
            order: () => ({
              limit: async (n: number) => ({ data: state.pipelineErrors.slice(0, n), error: null }),
            }),
          }),
        };
      }

      return {};
    },
  }),
}));

describe("GET /api/v1/admin/monitoring/overview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    process.env["NODE_ENV"] = "development";
    process.env["LLM_PROVIDER"] = "gemini";
    process.env["LLM_MODEL"] = "gemini-2.5-pro";

    state.pipelineConfig = {
      id: "singleton",
      enabled: true,
      cron_expression: "0 3 * * *",
      scheduled_for: "2026-05-19T03:00:00Z",
      last_completed_at: "2026-05-18T09:00:00Z",
      notify_webhook_url: "https://example.com/webhook",
      notify_webhook_events: ["run_completed"],
      google_places_budget_total: 200,
      google_places_budget_spent: 12.5,
      google_places_alert_threshold: 10,
      infra_monthly_cost_usd: 30,
      backup_monthly_cost_usd: 5,
    };

    state.pipelineRuns = [
      {
        id: "pipe-1",
        status: "completed",
        triggered_by: "cron",
        created_at: "2026-05-18T08:00:00Z",
        started_at: "2026-05-18T08:00:00Z",
        completed_at: "2026-05-18T09:00:00Z",
        dashboard_stale: false,
        phase_results: {
          discovery: { started_at: "2026-05-18T08:10:00Z", completed_at: "2026-05-18T08:25:00Z", items_processed: 30 },
          enrich: { started_at: "2026-05-18T08:25:00Z", completed_at: "2026-05-18T08:40:00Z", items_processed: 20 },
          score: { started_at: "2026-05-18T08:40:00Z", completed_at: "2026-05-18T08:45:00Z", items_processed: 100 },
        },
      },
    ];

    state.activeRun = {
      id: "pipe-active",
      status: "running",
      triggered_by: "manual",
      created_at: "2026-05-18T11:30:00Z",
      started_at: "2026-05-18T11:30:00Z",
      completed_at: null,
      dashboard_stale: false,
    };

    state.discoveryJobs = [
      {
        id: "job-1",
        source: "yelu",
        location: "Montevideo",
        niche: "restaurante",
        profile: null,
        status: "failed",
        triggered_by: "manual",
        created_at: "2026-05-18T10:00:00Z",
        started_at: "2026-05-18T10:01:00Z",
        completed_at: "2026-05-18T10:05:00Z",
        error_message: "timeout",
      },
    ];

    state.llmRows = [
      { provider: "gemini", total_tokens: 1200, cost_usd: 0.4, created_at: "2026-05-10T10:00:00Z" },
      { provider: "gemini", total_tokens: 800, cost_usd: 0.2, created_at: "2026-05-12T10:00:00Z" },
    ];

    state.costRuns = [
      { id: "run-1", stats: { estimated_cost_usd: 0.9, places_requests: 40 }, finished_at: "2026-05-08T08:00:00Z" },
    ];

    state.pipelineErrors = [
      {
        id: "err-1",
        occurred_at: "2026-05-18T10:02:00Z",
        run_id: "pipe-1",
        phase: "discovery",
        source: "yelu",
        lead_id: null,
        error_type: "timeout",
        message: "timeout",
        recovered: true,
      },
    ];
  });

  it("returns a unified monitoring overview contract", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/monitoring/overview",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.status).toBe("ok");
    expect(body.data.health).toMatchObject({
      db_connected: true,
      cron_missed: false,
      last_run_status: "completed",
    });
    expect(body.data.pipeline).toMatchObject({
      cron_enabled: true,
      active_run: expect.objectContaining({ id: "pipe-active", status: "running" }),
    });
    expect(body.data.discovery).toMatchObject({
      backlog: 0,
      recent_failed: [expect.objectContaining({ id: "job-1", status: "failed" })],
    });
    expect(body.data.costs).toMatchObject({
      month: "2026-05",
      totals: expect.objectContaining({ llm_usd: 0.6, google_places_usd: 0.9 }),
      google_places: expect.objectContaining({ budget_remaining: 187.5, request_count: 40 }),
    });
    expect(body.data.performance).toMatchObject({
      window_days: 30,
      runs: expect.objectContaining({ total: 1, successful: 1 }),
      throughput: expect.objectContaining({ enrich_per_hour: 80, score_per_hour: 1200 }),
    });
    expect(body.data.operational).toMatchObject({
      llm: expect.objectContaining({ provider_active: "gemini", model: "gemini-2.5-pro" }),
      webhook: expect.objectContaining({ configured: true }),
    });
  });
});
