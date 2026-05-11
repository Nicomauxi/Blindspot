import { describe, it, expect, vi, beforeEach } from "vitest";
import { leadsListCommand } from "../../src/cli/commands/leads-list.js";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  listLeads: vi.fn(),
}));

import { listLeads } from "../../src/storage/leads.js";

const mockListLeads = listLeads as ReturnType<typeof vi.fn>;

const makeLeads = (count: number, passed = true): Lead[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `lead-${i}`,
    place_id: `place_${i}`,
    niche: null,
    name: `Business ${i}`,
    address: `Street ${i}`,
    rating: 4.5,
    review_count: 30,
    website: passed ? null : null,
    whatsapp: null,
    phone: null,
    business_status: "OPERATIONAL",
    tags: passed ? ["profile:a"] : [`rejected:rating-too-low`],
    notes: null,
    state: "discovered" as const,
    first_seen_run_id: "run-001",
    last_seen_run_id: "run-001",
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: passed,
    rejection_reasons: passed ? [] : ["rating-too-low"],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

beforeEach(() => {
  mockListLeads.mockReset();
});

describe("leadsListCommand", () => {
  it("--run <id> without filters lists all leads for the run", async () => {
    const leads = makeLeads(3);
    mockListLeads.mockResolvedValue(leads);

    await leadsListCommand({ run: "run-abc-123" });

    expect(mockListLeads).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-abc-123" })
    );
  });

  it("--run <id> --rejected-only passes rejectedOnly flag", async () => {
    mockListLeads.mockResolvedValue(makeLeads(2, false));

    await leadsListCommand({ run: "run-abc", rejectedOnly: true });

    expect(mockListLeads).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedOnly: true, passedOnly: false })
    );
  });

  it("--run <id> --passed-only passes passedOnly flag", async () => {
    mockListLeads.mockResolvedValue(makeLeads(2, true));

    await leadsListCommand({ run: "run-abc", passedOnly: true });

    expect(mockListLeads).toHaveBeenCalledWith(
      expect.objectContaining({ passedOnly: true, rejectedOnly: false })
    );
  });

  it("--format json outputs valid parseable JSON", async () => {
    const leads = makeLeads(2);
    mockListLeads.mockResolvedValue(leads);

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (s: string) => output.push(s);

    try {
      await leadsListCommand({ run: "run-abc", format: "json" });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("without --run lists all leads from DB (no runId filter)", async () => {
    mockListLeads.mockResolvedValue(makeLeads(5));

    await leadsListCommand({});

    const callArg = mockListLeads.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("runId");
  });

  it("--run <id> passes runId (first_seen) and no seenInRunId", async () => {
    mockListLeads.mockResolvedValue(makeLeads(2));

    await leadsListCommand({ run: "run-first-001" });

    const callArg = mockListLeads.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).toHaveProperty("runId", "run-first-001");
    expect(callArg).not.toHaveProperty("seenInRunId");
  });

  it("--seen-in <id> passes seenInRunId (last_seen) and no runId", async () => {
    mockListLeads.mockResolvedValue(makeLeads(2));

    await leadsListCommand({ seenIn: "run-last-002" });

    const callArg = mockListLeads.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).toHaveProperty("seenInRunId", "run-last-002");
    expect(callArg).not.toHaveProperty("runId");
  });
});
