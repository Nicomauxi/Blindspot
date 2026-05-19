import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFrom,
  mockAppendRunLog,
  mockLoadWebhookConfig,
  mockNotifyWebhook,
  mockExecuteRefreshPhase,
  mockExecuteDiscoveryPhase,
  mockExecuteEnrichPhase,
  mockExecuteScorePhase,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAppendRunLog: vi.fn(),
  mockLoadWebhookConfig: vi.fn(),
  mockNotifyWebhook: vi.fn(),
  mockExecuteRefreshPhase: vi.fn(),
  mockExecuteDiscoveryPhase: vi.fn(),
  mockExecuteEnrichPhase: vi.fn(),
  mockExecuteScorePhase: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../src/modules/pipeline/crash-recovery.js", () => ({
  appendRunLog: mockAppendRunLog,
}));

vi.mock("../../src/modules/pipeline/webhook.js", () => ({
  loadWebhookConfig: mockLoadWebhookConfig,
  notifyWebhook: mockNotifyWebhook,
}));

vi.mock("../../src/modules/pipeline/phase-executors.js", () => ({
  executeRefreshPhase: mockExecuteRefreshPhase,
  executeDiscoveryPhase: mockExecuteDiscoveryPhase,
  executeEnrichPhase: mockExecuteEnrichPhase,
  executeScorePhase: mockExecuteScorePhase,
}));

import { executeRun } from "../../src/modules/pipeline/run-executor.js";
import type { PipelineRun } from "../../src/modules/pipeline/types.js";

function makeRun(overrides: PipelineRun["overrides"] = null): PipelineRun {
  return {
    id: "run-1",
    status: "pending",
    triggered_by: "manual",
    abort_requested: false,
    dashboard_stale: false,
    created_at: "2026-05-18T00:00:00Z",
    started_at: null,
    completed_at: null,
    config_snapshot: {
      id: "singleton",
      enabled: true,
      cron_expression: "0 2 * * 0",
      scheduled_for: null,
      last_completed_at: null,
      cpu_budget: "balanced",
      timeout_per_lead_sec: 120,
      max_retries: 2,
      phases: {
        refresh: { enabled: true, sources: ["google_places"], priority_tiers_first: true },
        discovery: { enabled: true, max_jobs: 2 },
        enrich: { enabled: true, with_heuristic: true, concurrency: 3 },
        score: { enabled: true, recalculate_buyer_types: true },
      },
      google_places_budget_total: 200,
      google_places_budget_spent: 0,
      google_places_alert_threshold: 10,
      notify_webhook_url: null,
      notify_webhook_secret: null,
      notify_webhook_events: ["run_completed"],
    },
    overrides,
    phase_results: null,
    log_lines: [],
    invariant_details: null,
    webhook_status: "not_configured",
  };
}

function buildPipelineRunTable(aborts: boolean[], invariantCount = 0) {
  const updates: unknown[] = [];

  mockFrom.mockImplementation((table: string) => {
    if (table === "pipeline_runs") {
      return {
        update: vi.fn((payload: unknown) => {
          updates.push(payload);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
        select: vi.fn((columns: string) => {
          if (columns === "abort_requested") {
            return {
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { abort_requested: aborts.length > 0 ? aborts.shift() : false },
                  error: null,
                }),
              })),
            };
          }

          return {
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { config_snapshot: makeRun().config_snapshot },
                error: null,
              }),
            })),
          };
        }),
      };
    }

    if (table === "leads") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({ count: invariantCount, error: null }),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });

  return { updates };
}

describe("executeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendRunLog.mockResolvedValue(undefined);
    mockLoadWebhookConfig.mockResolvedValue({ url: null, secret: null, events: [] });
    mockNotifyWebhook.mockResolvedValue("not_configured");
    mockExecuteRefreshPhase.mockResolvedValue({ itemsProcessed: 2 });
    mockExecuteDiscoveryPhase.mockResolvedValue({ itemsProcessed: 1 });
    mockExecuteEnrichPhase.mockResolvedValue({ itemsProcessed: 5 });
    mockExecuteScorePhase.mockResolvedValue({ itemsProcessed: 5 });
  });

  it("executes all enabled phases and completes a dry-run", async () => {
    const { updates } = buildPipelineRunTable([false, false, false, false, false, false, false, false], 0);

    const result = await executeRun(makeRun({ dry_run: true }));

    expect(result.status).toBe("completed");
    expect(mockExecuteRefreshPhase).toHaveBeenCalledWith(
      makeRun().config_snapshot!.phases.refresh,
      true
    );
    expect(mockExecuteDiscoveryPhase).toHaveBeenCalledWith(
      makeRun().config_snapshot!.phases.discovery,
      true
    );
    expect(mockExecuteEnrichPhase).toHaveBeenCalledWith(
      makeRun().config_snapshot!.phases.enrich,
      true
    );
    expect(mockExecuteScorePhase).toHaveBeenCalledWith(
      makeRun().config_snapshot!.phases.score,
      true
    );
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({
        status: "completed",
        dashboard_stale: false,
      })
    );
    expect(mockNotifyWebhook).toHaveBeenCalledWith(
      "run-1",
      "run_completed",
      expect.any(Object),
      expect.objectContaining({ status: "completed" })
    );
  });

  it("aborts after the current phase when abort_requested becomes true", async () => {
    const { updates } = buildPipelineRunTable([false, true], 0);

    const result = await executeRun(makeRun());

    expect(result.status).toBe("aborted");
    expect(mockExecuteRefreshPhase).toHaveBeenCalledTimes(1);
    expect(mockExecuteDiscoveryPhase).not.toHaveBeenCalled();
    expect(updates.at(-1)).toEqual(
      expect.objectContaining({
        status: "aborted",
        dashboard_stale: true,
      })
    );
  });

  it("fails the invariant check when passed leads remain unscored", async () => {
    buildPipelineRunTable([false, false, false, false, false, false, false, false], 3);

    const result = await executeRun(makeRun());

    expect(result.status).toBe("partial");
    expect(result.phase_results.invariant_check).toEqual(
      expect.objectContaining({
        status: "failed",
        error: "passed_sin_score=3",
      })
    );
  });
});
