import { describe, expect, it } from "vitest";
import {
  VALID_TRANSITIONS,
  CRM_COLUMNS,
  groupTrackingsByStatus,
  isTerminalStatus,
} from "../../ui/src/lib/crm-tracking";
import type { LeadTracking, CrmStatus } from "../../ui/src/lib/api";

const makeTracking = (overrides: Partial<LeadTracking>): LeadTracking => ({
  id: "tracking-1",
  lead_id: "lead-1",
  owner_id: "owner-1",
  status: "pending",
  campaign_id: null,
  notes: null,
  started_at: "2026-05-24T00:00:00Z",
  updated_at: "2026-05-24T00:00:00Z",
  ...overrides,
});

describe("CRM state machine", () => {
  it("has the 6 canonical statuses in correct order", () => {
    const statuses = CRM_COLUMNS.map((c) => c.status);
    expect(statuses).toEqual(["pending", "validation", "contact", "observed", "rejected", "accepted"]);
  });

  it("pending allows transition to validation and rejected only", () => {
    expect(VALID_TRANSITIONS.pending).toContain("validation");
    expect(VALID_TRANSITIONS.pending).toContain("rejected");
    expect(VALID_TRANSITIONS.pending).not.toContain("accepted");
    expect(VALID_TRANSITIONS.pending).not.toContain("contact");
  });

  it("contact allows transition to observed, accepted, and rejected", () => {
    expect(VALID_TRANSITIONS.contact).toContain("observed");
    expect(VALID_TRANSITIONS.contact).toContain("accepted");
    expect(VALID_TRANSITIONS.contact).toContain("rejected");
    expect(VALID_TRANSITIONS.contact).not.toContain("pending");
  });

  it("terminal states have no valid transitions", () => {
    expect(VALID_TRANSITIONS.rejected).toHaveLength(0);
    expect(VALID_TRANSITIONS.accepted).toHaveLength(0);
  });

  it("isTerminalStatus correctly identifies terminal states", () => {
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("accepted")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("contact")).toBe(false);
  });
});

describe("groupTrackingsByStatus", () => {
  const trackings: LeadTracking[] = [
    makeTracking({ id: "t1", status: "pending",    owner_id: "owner-1" }),
    makeTracking({ id: "t2", status: "contact",    owner_id: "owner-1" }),
    makeTracking({ id: "t3", status: "contact",    owner_id: "owner-2" }),
    makeTracking({ id: "t4", status: "accepted",   owner_id: "owner-2" }),
  ];

  it("groups all trackings by status without filter", () => {
    const grouped = groupTrackingsByStatus(trackings);
    expect(grouped.pending).toHaveLength(1);
    expect(grouped.contact).toHaveLength(2);
    expect(grouped.accepted).toHaveLength(1);
    expect(grouped.validation).toHaveLength(0);
  });

  it("filters by owner_id when provided", () => {
    const grouped = groupTrackingsByStatus(trackings, "owner-1");
    expect(grouped.pending).toHaveLength(1);
    expect(grouped.contact).toHaveLength(1);
    expect(grouped.accepted).toHaveLength(0);
  });

  it("returns empty arrays for statuses with no trackings", () => {
    const grouped = groupTrackingsByStatus([]);
    const statuses: CrmStatus[] = ["pending", "validation", "contact", "observed", "rejected", "accepted"];
    for (const status of statuses) {
      expect(grouped[status]).toHaveLength(0);
    }
  });
});
