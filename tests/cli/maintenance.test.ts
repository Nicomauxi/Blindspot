import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enrichCommand = vi.fn();
const scoreCommand = vi.fn();
const computeConcurrency = vi.fn();
const logInfo = vi.fn();
const mockGetDiscoveryConfig = vi.fn(() => ({
  source_refresh: { google_places: 30 },
}));

vi.mock("../../src/cli/commands/enrich.js", () => ({ enrichCommand }));
vi.mock("../../src/cli/commands/score.js", () => ({ scoreCommand }));
vi.mock("../../src/shared/ram.js", () => ({ computeConcurrency }));
vi.mock("../../src/shared/logger.js", () => ({
  getLogger: () => ({ info: logInfo, error: vi.fn() }),
}));
vi.mock("../../src/modules/discovery/config.js", () => ({
  getDiscoveryConfig: () => mockGetDiscoveryConfig(),
  getSourceRefreshDays: (source: string, fallback = 30) =>
    ({ google_places: 30, mintur: 90, osm: 90 } as Record<string, number>)[
      source
    ] ?? fallback,
}));

// Supabase mock: two chainable query builders.
// queryChain — used by queryStaleRuns (no .limit call)
// limitChain — returned by queryChain.limit(1), used by hasStaleLeadsForSource

let mockQueryData: Array<{ first_seen_run_id: string; niche: string }> = [];
let mockLimitData: Array<unknown> = [];

const limitChain: {
  then: (
    onfulfilled?: ((value: unknown) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null
  ) => Promise<unknown>;
} = {
  then: (onfulfilled, onrejected) =>
    Promise.resolve({ data: mockLimitData, error: null }).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    ),
};

const queryChain: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (
    onfulfilled?: ((value: unknown) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null
  ) => Promise<unknown>;
} = {
  select: vi.fn(),
  eq: vi.fn(),
  not: vi.fn(),
  or: vi.fn(),
  limit: vi.fn(),
  then: (onfulfilled, onrejected) =>
    Promise.resolve({ data: mockQueryData, error: null }).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined
    ),
};

queryChain.select.mockReturnValue(queryChain);
queryChain.eq.mockReturnValue(queryChain);
queryChain.not.mockReturnValue(queryChain);
queryChain.or.mockReturnValue(queryChain);
queryChain.limit.mockReturnValue(limitChain);

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({ from: () => queryChain }),
}));

describe("maintenanceCommandAction", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryData = [];
    mockLimitData = [];
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    computeConcurrency.mockReturnValue({
      mode: "conservative",
      concurrency: 2,
      freeRamMb: 4096,
      maxAllowedMb: 1638,
    });
    enrichCommand.mockResolvedValue(undefined);
    scoreCommand.mockResolvedValue(undefined);
    mockGetDiscoveryConfig.mockReturnValue({ source_refresh: { google_places: 30 } });
    // Restore chaining after clearAllMocks wipes call history
    queryChain.select.mockReturnValue(queryChain);
    queryChain.eq.mockReturnValue(queryChain);
    queryChain.not.mockReturnValue(queryChain);
    queryChain.or.mockReturnValue(queryChain);
    queryChain.limit.mockReturnValue(limitChain);
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("dry-run prints run count and exits without enriching", async () => {
    mockQueryData = [
      { first_seen_run_id: "run-aaa", niche: "dentist" },
      { first_seen_run_id: "run-bbb", niche: "hairdresser" },
    ];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({ dryRun: true });

    expect(consoleLog).toHaveBeenCalledWith(
      "Found 2 run(s) with stale/missing enrichment (Google Places)"
    );
    expect(enrichCommand).not.toHaveBeenCalled();
    expect(scoreCommand).not.toHaveBeenCalled();
  });

  it("processes all stale runs with enrichCommand", async () => {
    mockQueryData = [
      { first_seen_run_id: "run-111", niche: "dentist" },
      { first_seen_run_id: "run-222", niche: "dentist" },
    ];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({});

    expect(enrichCommand).toHaveBeenCalledTimes(2);
    expect(enrichCommand).toHaveBeenCalledWith(
      expect.objectContaining({ run: "run-111", withHeuristic: true })
    );
    expect(enrichCommand).toHaveBeenCalledWith(
      expect.objectContaining({ run: "run-222", withHeuristic: true })
    );
  });

  it("calls scoreCommand once after all enrichments complete", async () => {
    mockQueryData = [{ first_seen_run_id: "run-aaa", niche: "dentist" }];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({});

    expect(scoreCommand).toHaveBeenCalledTimes(1);
    expect(scoreCommand).toHaveBeenCalledWith({ all: true, dryRun: false });
  });

  it("respects --niche filter (only runs for that niche)", async () => {
    mockQueryData = [{ first_seen_run_id: "run-dentist", niche: "dentist" }];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({ niche: "dentist" });

    expect(queryChain.eq).toHaveBeenCalledWith("niche", "dentist");
  });

  it("uses concurrency from computeConcurrency()", async () => {
    computeConcurrency.mockReturnValue({
      mode: "conservative",
      concurrency: 3,
      freeRamMb: 4096,
      maxAllowedMb: 1638,
    });
    mockQueryData = [
      { first_seen_run_id: "run-aaa", niche: "dentist" },
      { first_seen_run_id: "run-bbb", niche: "dentist" },
      { first_seen_run_id: "run-ccc", niche: "dentist" },
    ];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({});

    expect(computeConcurrency).toHaveBeenCalledWith("conservative", undefined);
    expect(enrichCommand).toHaveBeenCalledTimes(3);
  });

  it("handles empty result (no stale runs) gracefully", async () => {
    mockQueryData = [];

    const { maintenanceCommandAction } = await import(
      "../../src/cli/commands/maintenance.js"
    );
    await maintenanceCommandAction({});

    expect(enrichCommand).not.toHaveBeenCalled();
    expect(scoreCommand).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith("No stale leads found. Nothing to do.");
  });

  describe("external source maintenance", () => {
    it("runs enrichCommand for source when stale leads exist", async () => {
      mockGetDiscoveryConfig.mockReturnValue({
        source_refresh: { google_places: 30, mintur: 90 },
      });
      mockQueryData = []; // no GP stale runs
      mockLimitData = [{ id: "lead-1" }]; // mintur has stale leads

      const { maintenanceCommandAction } = await import(
        "../../src/cli/commands/maintenance.js"
      );
      await maintenanceCommandAction({});

      expect(enrichCommand).toHaveBeenCalledWith(
        expect.objectContaining({ source: "mintur", withHeuristic: false })
      );
      expect(scoreCommand).toHaveBeenCalledTimes(1);
    });

    it("skips source when no stale leads", async () => {
      mockGetDiscoveryConfig.mockReturnValue({
        source_refresh: { google_places: 30, mintur: 90 },
      });
      mockQueryData = [];
      mockLimitData = []; // mintur has no stale leads

      const { maintenanceCommandAction } = await import(
        "../../src/cli/commands/maintenance.js"
      );
      await maintenanceCommandAction({});

      expect(enrichCommand).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith("No stale leads found. Nothing to do.");
    });

    it("dry-run lists external sources with stale leads", async () => {
      mockGetDiscoveryConfig.mockReturnValue({
        source_refresh: { google_places: 30, mintur: 90, osm: 90 },
      });
      mockQueryData = [];
      mockLimitData = [{ id: "lead-1" }]; // both mintur and osm are stale

      const { maintenanceCommandAction } = await import(
        "../../src/cli/commands/maintenance.js"
      );
      await maintenanceCommandAction({ dryRun: true });

      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("External sources with stale leads:")
      );
      expect(enrichCommand).not.toHaveBeenCalled();
    });

    it("no-op when no stale runs AND no stale external sources", async () => {
      mockGetDiscoveryConfig.mockReturnValue({
        source_refresh: { google_places: 30, mintur: 90 },
      });
      mockQueryData = [];
      mockLimitData = [];

      const { maintenanceCommandAction } = await import(
        "../../src/cli/commands/maintenance.js"
      );
      await maintenanceCommandAction({});

      expect(enrichCommand).not.toHaveBeenCalled();
      expect(scoreCommand).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledWith("No stale leads found. Nothing to do.");
    });

    it("uses --stale-days as override for all sources when provided", async () => {
      mockGetDiscoveryConfig.mockReturnValue({
        source_refresh: { google_places: 30, mintur: 90 },
      });
      mockQueryData = [];
      mockLimitData = [{ id: "lead-1" }];

      const { maintenanceCommandAction } = await import(
        "../../src/cli/commands/maintenance.js"
      );
      await maintenanceCommandAction({ staleDays: 14 });

      // With staleDays=14 as override, mintur uses 14 days instead of 90
      expect(enrichCommand).toHaveBeenCalledWith(
        expect.objectContaining({ source: "mintur" })
      );
    });
  });
});
