import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

const discoverCommand = vi.fn();
const enrichCommand = vi.fn();
const scoreCommand = vi.fn();
const socialEnrichCommand = vi.fn();
const computeConcurrency = vi.fn();
const loadLeadsByRunId = vi.fn();
const logInfo = vi.fn();
const logError = vi.fn();

vi.mock("../../src/cli/commands/discover.js", () => ({
  discoverCommand,
}));

vi.mock("../../src/cli/commands/enrich.js", () => ({
  enrichCommand,
}));

vi.mock("../../src/cli/commands/score.js", () => ({
  scoreCommand,
}));

vi.mock("../../src/cli/commands/social-enrich.js", () => ({
  socialEnrichCommand,
}));

vi.mock("../../src/shared/ram.js", () => ({
  computeConcurrency,
}));

vi.mock("../../src/storage/leads.js", () => ({
  loadLeadsByRunId,
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: () => ({
    info: logInfo,
    error: logError,
  }),
}));

const maybeSingle = vi.fn();
const limitOne = vi.fn().mockReturnThis();
const order = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const select = vi.fn().mockReturnThis();
const from = vi.fn(() => ({
  select,
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({
    from,
  }),
}));

function makeLead(
  name: string,
  score: number,
  passed = true,
  placeId = `${name}-id`
): Lead {
  return {
    id: `${name}-lead`,
    place_id: placeId,
    name,
    address: "Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    phone: null,
    whatsapp: null,
    business_status: null,
    google_data: {},
    digital_footprint: {},
    tags: [],
    notes: [],
    state: "discovered",
    passed_filter: passed,
    rejection_reasons: [],
    niche: "hairdresser",
    first_seen_run_id: "run-1",
    last_seen_run_id: "run-1",
    prospect_score: score,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    score_breakdown: {},
    systems_gap_breakdown: {},
    created_at: "",
    updated_at: "",
  } as Lead;
}

function mockRunLookup(rows: Record<string, { id: string; stats: Record<string, unknown> }>) {
  maybeSingle.mockImplementation(async () => {
    const nicheCall = eq.mock.calls.find(([field]) => field === "niche");
    const locationCall = eq.mock.calls.find(([field]) => field === "location");
    const profileCall = eq.mock.calls.find(([field]) => field === "profile");
    const key = `${nicheCall?.[1]}|${locationCall?.[1]}|${profileCall?.[1]}`;
    eq.mockClear();
    return { data: rows[key] ?? null, error: null };
  });

  select.mockImplementation(() => ({
    eq,
  }));
  eq.mockImplementation(() => ({
    eq,
    order,
  }));
  order.mockImplementation(() => ({
    limit: limitOne,
  }));
  limitOne.mockImplementation(() => ({
    maybeSingle,
  }));
}

describe("runCommandAction", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    computeConcurrency.mockReturnValue({
      mode: "conservative",
      concurrency: 1,
      freeRamMb: 2048,
      maxAllowedMb: 819,
    });
    discoverCommand.mockResolvedValue(undefined);
    enrichCommand.mockResolvedValue(undefined);
    scoreCommand.mockResolvedValue(undefined);
    socialEnrichCommand.mockResolvedValue(undefined);
    loadLeadsByRunId.mockResolvedValue([
      makeLead("Juana", 77),
      makeLead("La Proa", 72),
      makeLead("Rejected", 20, false),
    ]);
    mockRunLookup({
      "hairdresser|Montevideo|a": {
        id: "run-1",
        stats: { leads_discovered: 3, leads_rejected: 1, leads_new: 2 },
      },
      "hairdresser|Punta del Este|a": {
        id: "run-2",
        stats: { leads_discovered: 2, leads_rejected: 0, leads_new: 1 },
      },
    });
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("runs full pipeline for a single location", async () => {
    const { runCommandAction } = await import("../../src/cli/commands/run.js");

    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo"],
      profile: "a",
    });

    expect(discoverCommand).toHaveBeenCalledTimes(1);
    expect(enrichCommand).toHaveBeenCalledWith(
      expect.objectContaining({ run: "run-1", withHeuristic: true })
    );
    expect(scoreCommand).toHaveBeenCalledTimes(2);
    expect(socialEnrichCommand).toHaveBeenCalledWith(
      expect.objectContaining({ run: "run-1", limit: 10 })
    );
  });

  it("skips enrich and score in dry-run mode", async () => {
    const { runCommandAction } = await import("../../src/cli/commands/run.js");

    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo"],
      profile: "a",
      dryRun: true,
    });

    expect(discoverCommand).toHaveBeenCalledTimes(1);
    expect(enrichCommand).not.toHaveBeenCalled();
    expect(scoreCommand).not.toHaveBeenCalled();
    expect(socialEnrichCommand).not.toHaveBeenCalled();
  });

  it("skips social-enrich when --no-social is set", async () => {
    const { runCommandAction } = await import("../../src/cli/commands/run.js");

    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo"],
      profile: "a",
      noSocial: true,
    });

    expect(scoreCommand).toHaveBeenCalledTimes(1);
    expect(socialEnrichCommand).not.toHaveBeenCalled();
  });

  it("uses configured concurrency across multiple locations", async () => {
    computeConcurrency.mockReturnValue({
      mode: "auto",
      concurrency: 2,
      freeRamMb: 4096,
      maxAllowedMb: 3276,
    });

    let active = 0;
    let maxActive = 0;
    discoverCommand.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });

    const { runCommandAction } = await import("../../src/cli/commands/run.js");

    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo", "Punta del Este"],
      profile: "a",
    });

    expect(maxActive).toBe(2);
  });

  it("throws when manual RAM configuration is rejected", async () => {
    computeConcurrency.mockImplementation(() => {
      throw new Error("manual overflow");
    });

    const { runCommandAction } = await import("../../src/cli/commands/run.js");

    await expect(
      runCommandAction({
        niche: "hairdresser",
        location: ["Montevideo"],
        profile: "a",
        ramMode: "manual",
        concurrency: 99,
      })
    ).rejects.toThrow("manual overflow");
  });

  it("propagates --override values to discoverCommand", async () => {
    const { runCommandAction } = await import("../../src/cli/commands/run.js");
    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo"],
      profile: "a",
      overrides: ["min_reviews=20"],
    });
    expect(discoverCommand).toHaveBeenCalledWith(
      expect.objectContaining({ override: ["min_reviews=20"] })
    );
  });

  it("defaults overrides to empty array when flag is omitted", async () => {
    const { runCommandAction } = await import("../../src/cli/commands/run.js");
    await runCommandAction({
      niche: "hairdresser",
      location: ["Montevideo"],
      profile: "a",
    });
    expect(discoverCommand).toHaveBeenCalledWith(
      expect.objectContaining({ override: [] })
    );
  });
});
