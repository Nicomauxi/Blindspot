import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryCandidate, Lead } from "../../src/shared/types.js";

const discover = vi.fn();
const loadAllLeads = vi.fn();
const loadRuntimeLists = vi.fn();
const addCorroboratingSource = vi.fn();
const insertExternalLead = vi.fn();
const findCrossSourceMatch = vi.fn();
const isFranchise = vi.fn();

vi.mock("../../src/modules/discovery/providers/mintur.js", () => ({
  MINTURProvider: class {
    discover = discover;
  },
}));
vi.mock("../../src/modules/discovery/providers/osm.js", () => ({
  OSMProvider: class {
    discover = discover;
  },
}));
vi.mock("../../src/modules/discovery/providers/yelu.js", () => ({
  YeluProvider: class {
    discover = discover;
  },
}));
vi.mock("../../src/modules/discovery/providers/pedidosya.js", () => ({
  PedidosYaProvider: class {
    discover = discover;
  },
}));
vi.mock("../../src/storage/leads.js", () => ({ loadAllLeads }));
vi.mock("../../src/storage/system-lists.js", () => ({ loadRuntimeLists }));
vi.mock("../../src/storage/external-leads.js", () => ({
  addCorroboratingSource,
  insertExternalLead,
}));
vi.mock("../../src/modules/discovery/deduplication.js", () => ({
  findCrossSourceMatch,
  isFranchise,
}));

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    source: "mintur",
    external_id: "42",
    source_confidence: 0.8,
    name: "Hotel Ejemplo",
    address: "Av. Principal 123, Montevideo",
    phone: "099123456",
    website: null,
    email: null,
    latitude: null,
    longitude: null,
    niche: "tourism",
    raw: { _id: 42 },
    ...overrides,
  };
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "google_places:gp-1",
    source: "google_places",
    external_id: "gp-1",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: 0.5,
    contact_reliability_score: 0.1,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "tourism",
    name: "Hotel Ejemplo",
    address: "Av. Principal 123, Montevideo",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    inferred_state: null,
    gps: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("discoverExternalCommand", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    loadRuntimeLists.mockResolvedValue({ franchiseNames: new Set<string>() });
    loadAllLeads.mockResolvedValue([]);
    discover.mockResolvedValue([]);
    addCorroboratingSource.mockResolvedValue(null);
    insertExternalLead.mockResolvedValue(null);
    findCrossSourceMatch.mockReturnValue(null);
    isFranchise.mockReturnValue(false);
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("corroborates instead of inserting when findCrossSourceMatch returns an existing lead", async () => {
    const match = lead();
    discover.mockResolvedValue([candidate()]);
    loadAllLeads.mockResolvedValue([match]);
    findCrossSourceMatch.mockReturnValue(match);
    addCorroboratingSource.mockResolvedValue({
      ...match,
      corroborating_sources: [{ source: "mintur", external_id: "42", seen_at: "2026-01-01T00:00:00.000Z", confidence: 0.8 }],
    });

    const { discoverExternalCommand } = await import("../../src/cli/commands/discover-external.js");
    await discoverExternalCommand({ source: "mintur", location: "Montevideo", niche: "tourism", dryRun: false });

    expect(addCorroboratingSource).toHaveBeenCalledWith(match.id, candidate(), { dryRun: false });
    expect(insertExternalLead).not.toHaveBeenCalled();
  });

  it("passes franchise tag on insert when no cross-source match exists", async () => {
    const hotel = candidate({ name: "Abitab Centro", external_id: "77" });
    discover.mockResolvedValue([hotel]);
    isFranchise.mockReturnValue(true);

    const { discoverExternalCommand } = await import("../../src/cli/commands/discover-external.js");
    await discoverExternalCommand({ source: "mintur", location: "Montevideo", niche: "tourism", dryRun: false });

    expect(insertExternalLead).toHaveBeenCalledWith(
      hotel,
      expect.objectContaining({ extraTags: ["franchise-detected"], dryRun: false })
    );
  });
});
