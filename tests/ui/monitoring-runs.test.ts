import { describe, expect, it } from "vitest";
import { summarizeRunCard, summarizeRunPhases } from "../../ui/src/lib/monitoring-runs";
import type { PipelineRun } from "../../ui/src/lib/api";

const run: PipelineRun = {
  id: "run-1",
  status: "running",
  triggered_by: "manual",
  overrides: { dry_run: true, phases: ["discovery", "score"] },
  dashboard_stale: false,
  created_at: "2026-05-25T10:00:00.000Z",
  started_at: "2026-05-25T10:01:00.000Z",
  completed_at: null,
  phase_results: {
    score: { started_at: "2026-05-25T10:10:00.000Z", items_processed: 100 },
    discovery: { started_at: "2026-05-25T10:02:00.000Z", completed_at: "2026-05-25T10:09:00.000Z", items_processed: 40 },
    invariant_check: { status: "completed" },
  },
};

describe("monitoring run summaries", () => {
  it("orders and normalizes phase summaries", () => {
    const phases = summarizeRunPhases(run.phase_results);

    expect(phases.map((phase) => phase.key)).toEqual(["invariant_check", "discovery", "score"]);
    expect(phases.map((phase) => phase.status)).toEqual(["completed", "completed", "running"]);
    expect(phases[1]?.itemsProcessed).toBe(40);
  });

  it("builds card-level run summaries", () => {
    const summary = summarizeRunCard(run);

    expect(summary.completedPhases).toBe(2);
    expect(summary.runningPhase).toBe("score");
    expect(summary.requestedPhases).toBe(2);
    expect(summary.isDryRun).toBe(true);
  });
});
