import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverOrphanedJobs } from "../../src/modules/pipeline/crash-recovery.js";

// D9: el crash-recovery solo cubría pipeline_runs. Si el proceso muere a mitad de
// un discovery job (tabla `runs` o `discovery_jobs`), la fila queda 'running' para
// siempre: el claim CAS queued→running nunca revierte y el job deja de ser elegible.

type Row = { id: string; started_at: string | null };

const state = vi.hoisted(() => ({
  runsRunning: [] as Row[],
  jobsRunning: [] as Row[],
  failedRuns: [] as string[],
  failedJobs: [] as string[],
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, val: string) =>
          val === "running"
            ? Promise.resolve({
                data: table === "runs" ? state.runsRunning : state.jobsRunning,
                error: null,
              })
            : Promise.resolve({ data: [], error: null })
        ),
      })),
      update: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => ({
          eq: vi.fn(() => {
            if (table === "runs") state.failedRuns.push(id);
            else state.failedJobs.push(id);
            return Promise.resolve({ error: null });
          }),
        })),
      })),
    }),
  }),
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("recoverOrphanedJobs (D9)", () => {
  beforeEach(() => {
    state.runsRunning = [];
    state.jobsRunning = [];
    state.failedRuns = [];
    state.failedJobs = [];
  });

  it("marca como failed los runs externos 'running' viejos (zombies)", async () => {
    state.runsRunning = [{ id: "run-zombie", started_at: new Date(Date.now() - 60 * 60_000).toISOString() }];
    const recovered = await recoverOrphanedJobs();
    expect(state.failedRuns).toContain("run-zombie");
    expect(recovered).toBeGreaterThanOrEqual(1);
  });

  it("NO toca runs 'running' recientes (pueden estar vivos en otro proceso)", async () => {
    state.runsRunning = [{ id: "run-fresh", started_at: new Date(Date.now() - 60_000).toISOString() }];
    await recoverOrphanedJobs();
    expect(state.failedRuns).not.toContain("run-fresh");
  });

  it("marca como failed los discovery_jobs 'running' viejos", async () => {
    state.jobsRunning = [{ id: "job-zombie", started_at: new Date(Date.now() - 60 * 60_000).toISOString() }];
    await recoverOrphanedJobs();
    expect(state.failedJobs).toContain("job-zombie");
  });

  it("NO toca discovery_jobs 'running' recientes", async () => {
    state.jobsRunning = [{ id: "job-fresh", started_at: new Date(Date.now() - 60_000).toISOString() }];
    await recoverOrphanedJobs();
    expect(state.failedJobs).not.toContain("job-fresh");
  });
});
