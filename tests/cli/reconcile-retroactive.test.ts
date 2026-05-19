import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadAllLeads = vi.fn();
const reconcileLeadIntoPrimary = vi.fn();
const detectOwnerGroups = vi.fn();
const getRetroactiveDedupThreshold = vi.fn(() => 0.9);
const getDedupGeoRadiusMeters = vi.fn(() => 500);
const buildRetroactiveReconciliationPlan = vi.fn();

vi.mock("../../src/storage/leads.js", () => ({ loadAllLeads }));
vi.mock("../../src/storage/owner-group.js", () => ({ detectOwnerGroups }));
vi.mock("../../src/storage/reconciliation.js", () => ({ reconcileLeadIntoPrimary }));
vi.mock("../../src/modules/discovery/config.js", () => ({
  getRetroactiveDedupThreshold,
  getDedupGeoRadiusMeters,
}));
vi.mock("../../src/modules/discovery/reconciliation.js", () => ({
  buildRetroactiveReconciliationPlan,
  describeRetroactiveGroup: vi.fn(() => "hotel bahia [google_places, mintur]"),
}));

describe("reconcileRetroactiveCommand", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    loadAllLeads.mockResolvedValue([]);
    buildRetroactiveReconciliationPlan.mockReturnValue({
      total_leads: 2,
      threshold: 0.9,
      geo_radius_meters: 500,
      groups: [],
      matches: [],
      groups_with_matches: 0,
      matched_secondaries: 0,
      expected_remaining_leads: 2,
      by_source_pair: {},
      phone_conflicts: 0,
      email_conflicts: 0,
    });
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("prints a dry-run report by default", async () => {
    const { reconcileRetroactiveCommand } = await import("../../src/cli/commands/reconcile-retroactive.js");

    await reconcileRetroactiveCommand({ apply: false });

    expect(loadAllLeads).toHaveBeenCalledOnce();
    expect(buildRetroactiveReconciliationPlan).toHaveBeenCalledWith([], {
      threshold: 0.9,
      geoRadiusMeters: 500,
    });
    expect(reconcileLeadIntoPrimary).not.toHaveBeenCalled();
  });

  it("applies every secondary in the selected groups when --apply is used", async () => {
    buildRetroactiveReconciliationPlan.mockReturnValue({
      total_leads: 3,
      threshold: 0.9,
      geo_radius_meters: 500,
      groups: [
        {
          primary: { id: "p1", source: "google_places", name: "A" },
          secondaries: [{ id: "s1" }, { id: "s2" }],
        },
      ],
      matches: [],
      groups_with_matches: 1,
      matched_secondaries: 2,
      expected_remaining_leads: 1,
      by_source_pair: { "google_places<-mintur": 1, "google_places<-yelu": 1 },
      phone_conflicts: 0,
      email_conflicts: 0,
    });

    const { reconcileRetroactiveCommand } = await import("../../src/cli/commands/reconcile-retroactive.js");
    await reconcileRetroactiveCommand({ apply: true });

    expect(reconcileLeadIntoPrimary).toHaveBeenCalledTimes(2);
    expect(reconcileLeadIntoPrimary).toHaveBeenNthCalledWith(1, "p1", "s1");
    expect(reconcileLeadIntoPrimary).toHaveBeenNthCalledWith(2, "p1", "s2");
    expect(detectOwnerGroups).toHaveBeenCalledOnce();
  });
});
