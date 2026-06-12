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

// Mock que sirve TODA la data en la primera página (range). El loop de paginación
// corta porque batch.length < PAGE_SIZE.
function makeSelectMock(data: unknown[]) {
  return {
    select: () => ({
      not: () => ({ range: () => Promise.resolve({ data, error: null }) }),
    }),
    update: () => ({ in: mockUpdateIn }),
  };
}

// Mock que devuelve una página distinta por llamada a range() (para N8.1).
function makePaginatedMock(pages: unknown[][]) {
  let call = 0;
  return {
    select: () => ({
      not: () => ({
        range: () => Promise.resolve({ data: pages[call++] ?? [], error: null }),
      }),
    }),
    update: () => ({ in: mockUpdateIn }),
  };
}

describe("detectOwnerGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateIn.mockResolvedValue({ error: null });
  });

  it("groups leads sharing the same canonical mobile phone", async () => {
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

  // --- F1.1: anti sobre-fusión ---

  it("does NOT group two leads that share only a gestor/contador email", async () => {
    // Mismo email de gestor, distintos negocios, sin teléfono móvil propio compartido.
    const leads = [
      { id: LEAD_A, canonical_fields: { email: { value: "gestor@contador.com" } }, owner_group_id: null },
      { id: LEAD_B, canonical_fields: { email: { value: "gestor@contador.com" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("does NOT group two leads sharing a landline (gestor office number)", async () => {
    // 24070000 es un fijo de gestor compartido por 52 leads DEI en producción.
    const leads = [
      { id: LEAD_A, canonical_fields: { phone: { value: "24070000" } }, owner_group_id: null },
      { id: LEAD_B, canonical_fields: { phone: { value: "24070000" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("does NOT group leads sharing a junk phone ('0')", async () => {
    const leads = [
      { id: LEAD_A, canonical_fields: { phone: { value: "0" } }, owner_group_id: null },
      { id: LEAD_B, canonical_fields: { phone: { value: "0" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("does NOT group when a mobile is shared by too many leads (generic/agency number)", async () => {
    // Un móvil compartido por >5 leads es señal genérica (agencia/gestor), no de dueño.
    const leads = Array.from({ length: 7 }, (_, i) => ({
      id: `eeeeeeee-0000-0000-0000-00000000000${i}`,
      canonical_fields: { phone: { value: "+598 99 222 222" } },
      owner_group_id: null,
    }));
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(0);
    expect(result.leads_assigned).toBe(0);
  });

  it("groups leads sharing an own mobile stored in the `phone` column (DEI path)", async () => {
    // La mayoría de los leads (DEI) guardan el teléfono en la columna `phone`,
    // no en canonical_fields. El owner-grouping debe verlos igual.
    const leads = [
      { id: LEAD_A, canonical_fields: {}, phone: "095835008", owner_group_id: null },
      { id: LEAD_B, canonical_fields: {}, phone: "+598 95 835 008", owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makeSelectMock(leads));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(1);
    expect(result.leads_assigned).toBe(2);
  });

  // --- N8.1: paginación más allá de 1000 filas (max_rows de PostgREST) ---

  it("paginates beyond the 1000-row PostgREST cap", async () => {
    // Página 0: 1000 leads con móviles únicos (no agrupan).
    const page0 = Array.from({ length: 1000 }, (_, i) => ({
      id: `f0000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      canonical_fields: { phone: { value: `9${String(i).padStart(7, "0")}` } },
      owner_group_id: null,
    }));
    // Página 1: 2 leads que comparten un móvil → solo agrupan si la página 1 se leyó.
    const page1 = [
      { id: LEAD_A, canonical_fields: { phone: { value: "+598 99 333 333" } }, owner_group_id: null },
      { id: LEAD_B, canonical_fields: { phone: { value: "+598 99 333 333" } }, owner_group_id: null },
    ];
    mockFrom.mockReturnValue(makePaginatedMock([page0, page1, []]));

    const { detectOwnerGroups } = await import("../../src/storage/owner-group.js");
    const result = await detectOwnerGroups();
    expect(result.groups_created).toBe(1);
    expect(result.leads_assigned).toBe(2);
  });
});
