import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  pipelineRuns: Row[];
  pipelineErrors: Row[];
  leads: Row[];
} = {
  user: {
    id: "admin-id",
    email: "admin@test.local",
    role: "admin",
    active: true,
    lead_filter: null,
  },
  pipelineRuns: [],
  pipelineErrors: [],
  leads: [],
};

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

      if (table === "pipeline_runs") {
        return {
          select: () => ({
            order: () => ({
              limit: async (n: number) => ({ data: state.pipelineRuns.slice(0, n), error: null }),
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

      if (table === "leads") {
        return {
          select: () => ({
            order: () => ({
              limit: async (n: number) => ({ data: state.leads.slice(0, n), error: null }),
            }),
          }),
        };
      }

      return {};
    },
  }),
}));

describe("GET /api/v1/admin/performance/*", () => {
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

    state.pipelineRuns = [
      {
        id: "pipe-1",
        status: "completed",
        created_at: "2026-05-15T08:00:00Z",
        started_at: "2026-05-15T08:00:00Z",
        completed_at: "2026-05-15T09:00:00Z",
        phase_results: {
          refresh: { started_at: "2026-05-15T08:00:00Z", completed_at: "2026-05-15T08:20:00Z", status: "ok", items_processed: 40 },
          discovery: { started_at: "2026-05-15T08:20:00Z", completed_at: "2026-05-15T08:35:00Z", status: "ok", items_processed: 30 },
          enrich: { started_at: "2026-05-15T08:35:00Z", completed_at: "2026-05-15T08:50:00Z", status: "ok", items_processed: 15 },
          score: { started_at: "2026-05-15T08:50:00Z", completed_at: "2026-05-15T08:55:00Z", status: "ok", items_processed: 90 },
          invariant_check: { started_at: "2026-05-15T08:55:00Z", completed_at: "2026-05-15T09:00:00Z", status: "ok", items_processed: 0 },
        },
      },
      {
        id: "pipe-2",
        status: "partial",
        created_at: "2026-05-16T08:00:00Z",
        started_at: "2026-05-16T08:00:00Z",
        completed_at: "2026-05-16T09:30:00Z",
        phase_results: {
          refresh: { started_at: "2026-05-16T08:00:00Z", completed_at: "2026-05-16T08:30:00Z", status: "ok", items_processed: 45 },
          discovery: { started_at: "2026-05-16T08:30:00Z", completed_at: "2026-05-16T09:00:00Z", status: "failed", items_processed: 12 },
          enrich: { started_at: "2026-05-16T09:00:00Z", completed_at: "2026-05-16T09:20:00Z", status: "ok", items_processed: 20 },
          score: { started_at: "2026-05-16T09:20:00Z", completed_at: "2026-05-16T09:25:00Z", status: "ok", items_processed: 110 },
          invariant_check: { started_at: "2026-05-16T09:25:00Z", completed_at: "2026-05-16T09:30:00Z", status: "ok", items_processed: 0 },
        },
      },
    ];

    state.pipelineErrors = [
      {
        id: "err-1",
        occurred_at: "2026-05-16T08:40:00Z",
        run_id: "pipe-2",
        phase: "discovery",
        source: "yelu",
        lead_id: "lead-2",
        error_type: "http_429",
        message: "Yelu rate limited",
        stack: "stacktrace",
        recovered: true,
      },
      {
        id: "err-2",
        occurred_at: "2026-05-16T09:05:00Z",
        run_id: "pipe-2",
        phase: "enrich",
        source: "google_places",
        lead_id: "lead-1",
        error_type: "timeout",
        message: "Website timeout",
        stack: null,
        recovered: true,
      },
    ];

    state.leads = [
      {
        id: "lead-1",
        name: "Cafe Sur",
        source: "google_places",
        updated_at: "2026-05-16T09:10:00Z",
        prospect_score: 62,
        gps: { type: "Point" },
        inferred_state: { digitalization_level: "basic" },
        digital_footprint: {
          email_quality: [{ quality: "generic" }],
          phone_classification: [{ type: "mobile" }],
          last_change_diff: {
            changed_at: "2026-05-16T09:10:00Z",
            changes: [
              { field: "has_website", from: false, to: true, significance: "critical" },
              { field: "contact_tier", from: "C", to: "A", significance: "critical" },
            ],
          },
        },
        score_breakdown: { contact_tier: "A" },
      },
      {
        id: "lead-2",
        name: "Hotel Centro",
        source: "yelu",
        updated_at: "2026-05-16T08:45:00Z",
        prospect_score: 42,
        gps: null,
        inferred_state: null,
        digital_footprint: {
          email_quality: [{ quality: "unknown" }],
          phone_classification: [{ type: "unknown" }],
        },
        score_breakdown: { contact_tier: "X" },
      },
      {
        id: "lead-3",
        name: "Panaderia Norte",
        source: "google_places",
        updated_at: "2026-05-15T08:45:00Z",
        prospect_score: 58,
        gps: { type: "Point" },
        inferred_state: { digitalization_level: "advanced" },
        digital_footprint: {
          email_quality: [{ quality: "generic" }],
          phone_classification: [{ type: "landline" }],
        },
        score_breakdown: { contact_tier: "B" },
      },
    ];
  });

  it("returns overview metrics derived from pipeline_runs, errors and leads", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/performance/overview?days=30",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.runs).toMatchObject({
      total: 2,
      successful: 1,
      partial: 1,
      failed: 0,
    });
    expect(body.data.duration).toMatchObject({
      avg_min: 75,
      total_hours: 2.5,
    });
    expect(body.data.throughput).toMatchObject({
      enrich_per_hour: 60,
      score_per_hour: 1200,
      discovery_per_min: 0.93,
    });
    expect(body.data.success_rate_per_source).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "google_places", success: 1, total: 2, errors: 1, pct: 50 }),
        expect.objectContaining({ source: "yelu", success: 0, total: 1, errors: 1, pct: 0 }),
      ])
    );
  });

  it("returns filtered recent errors", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/performance/errors?days=7&phase=discovery&source=yelu&error_type=http_429",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "err-1",
      phase: "discovery",
      source: "yelu",
      error_type: "http_429",
      recovered: true,
    });
  });

  it("returns coverage and change summary for the selected run window", async () => {
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/performance/quality?run_id=pipe-2&days=30",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.data.run_id).toBe("pipe-2");
    expect(body.data.coverage).toMatchObject({
      total_leads: 3,
      email_quality_pct: 66.7,
      phone_type_pct: 66.7,
      coords_pct: 66.7,
      inferred_state_pct: 66.7,
      contactable_tier_pct: 66.7,
    });
    expect(body.data.changes).toMatchObject({
      significant_total: 2,
      tier_gained: 1,
      tier_lost: 0,
      new_hot: 1,
      score_up_15: 0,
      score_down_15: 0,
    });
    expect(body.data.changes.by_field).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "has_website", count: 1 }),
        expect.objectContaining({ field: "contact_tier", count: 1 }),
      ])
    );
  });
});
