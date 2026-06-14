import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverOrphanedRuns } from "../../src/modules/pipeline/crash-recovery.js";

// N39: el recovery de runs 'running' debe exigir antigüedad mínima — abortar
// incondicionalmente mataba runs legítimos con horas de trabajo (caso real: 6h15m).

const state = vi.hoisted(() => ({
  runningRows: [] as Array<{ id: string; log_lines: unknown[]; started_at: string | null }>,
  abortedIds: [] as string[],
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain["eq"] = vi.fn((_col: string, val: string) => {
          if (val === "running") return Promise.resolve({ data: state.runningRows, error: null });
          return { ...chain, lt: vi.fn(() => Promise.resolve({ data: [], error: null })), eq: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        });
        chain["lt"] = vi.fn(() => Promise.resolve({ data: [], error: null }));
        return chain;
      }),
      update: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => ({
          eq: vi.fn(() => {
            state.abortedIds.push(id);
            return Promise.resolve({ error: null });
          }),
        })),
      })),
    }),
  }),
}));

describe("recoverOrphanedRuns — umbral de edad (N39)", () => {
  beforeEach(() => {
    state.runningRows = [];
    state.abortedIds = [];
  });

  it("NO aborta un run 'running' reciente (puede estar vivo en otro proceso)", async () => {
    state.runningRows = [
      { id: "fresh", log_lines: [], started_at: new Date(Date.now() - 60_000).toISOString() },
    ];
    const recovered = await recoverOrphanedRuns();
    expect(recovered).toBe(0);
    expect(state.abortedIds).not.toContain("fresh");
  });

  it("aborta un run 'running' viejo (>15min sin terminar = zombie)", async () => {
    state.runningRows = [
      { id: "zombie", log_lines: [], started_at: new Date(Date.now() - 60 * 60_000).toISOString() },
    ];
    const recovered = await recoverOrphanedRuns();
    expect(recovered).toBe(1);
    expect(state.abortedIds).toContain("zombie");
  });
});
