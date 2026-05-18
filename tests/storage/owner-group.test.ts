import { describe, it, expect, vi, beforeEach } from "vitest";

const LEAD_A = "aaaaaaaa-0000-0000-0000-000000000001";
const LEAD_B = "bbbbbbbb-0000-0000-0000-000000000001";
const LEAD_C = "cccccccc-0000-0000-0000-000000000001";
const GROUP_UUID = "dddddddd-0000-0000-0000-000000000001";

vi.mock("crypto", () => ({
  randomUUID: () => GROUP_UUID,
}));

const mockUpdateIn = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn();

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const sharedPhoneLeads = [
  { id: LEAD_A, canonical_fields: { phone: { value: "+598 99 111 111" } }, owner_group_id: null },
  { id: LEAD_B, canonical_fields: { phone: { value: "+598 99 111 111" } }, owner_group_id: null },
  { id: LEAD_C, canonical_fields: { email: "other@email.com" }, owner_group_id: null },
];

function makeSelectMock(data: unknown[]) {
  return {
    select: () => ({
      // Supabase query builder is PromiseLike; not() returns a thenable
      not: () => Promise.resolve({ data, error: null }),
    }),
    update: () => ({ in: mockUpdateIn }),
  };
}

describe("detectOwnerGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateIn.mockResolvedValue({ error: null });
  });

  it("groups leads sharing the same canonical phone", async () => {
    mockFrom.mockReturnValue(makeSelectMock(sharedPhoneLeads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(1);
    expect(result.leads_assigned).toBe(2);
  });

  it("returns zero when no enriched leads exist", async () => {
    mockFrom.mockReturnValue(makeSelectMock([]));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("does not create groups for a lead with no match", async () => {
    const singleLead = [
      { id: LEAD_A, canonical_fields: { phone: { value: "+598 99 111 111" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(singleLead));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("merges into existing group when one lead already has owner_group_id", async () => {
    const leads = [
      { id: LEAD_A, canonical_fields: { phone: { value: "+598 99 111 111" } }, owner_group_id: GROUP_UUID },
      { id: LEAD_B, canonical_fields: { phone: { value: "+598 99 111 111" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.leads_assigned).toBe(1);
    expect(mockUpdateIn).toHaveBeenCalledWith("id", [LEAD_B]);
  });
});
