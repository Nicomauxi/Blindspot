import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { countLeadsByFilterSelection, loadLeadsByFilterSelection } from "../../src/storage/leads.js";

function makeQueryChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return chain;
}

describe("countLeadsByFilterSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters only by contact_tier when specified", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 5;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    const count = await countLeadsByFilterSelection({ contact_tier: "A" });

    expect(mockFrom).toHaveBeenCalledWith("lead_dashboard");
    expect((chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("contact_tier", "A");
    expect(count).toBe(5);
  });

  it("applies missing_gps filter with .is('gps', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 12;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_gps: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("gps", null);
  });

  it("applies missing_address filter with .is('address', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 3;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_address: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("address", null);
  });

  it("applies missing_phone filter with .is('phone', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 8;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_phone: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("phone", null);
  });

  it("applies missing_email filter with .is('contact_email', null)", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 20;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_email: true });

    expect((chain.is as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("contact_email", null);
  });

  it("applies multiple missing_* filters together", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 7;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ missing_gps: true, missing_phone: true });

    const isArgs = (chain.is as ReturnType<typeof vi.fn>).mock.calls;
    expect(isArgs).toContainEqual(["gps", null]);
    expect(isArgs).toContainEqual(["phone", null]);
  });

  it("does not call .is() when missing_* flags are false or absent", async () => {
    const chain = makeQueryChain();
    (chain as { count: number | null; error: null }).count = 0;
    (chain as { error: null }).error = null;
    mockFrom.mockReturnValue(chain);

    await countLeadsByFilterSelection({ contact_tier: "B", missing_gps: false });

    expect((chain.is as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("throws when the database returns an error", async () => {
    const chain = makeQueryChain();
    (chain as { count: null; error: { message: string } }).count = null;
    (chain as { error: { message: string } }).error = { message: "db timeout" };
    mockFrom.mockReturnValue(chain);

    await expect(countLeadsByFilterSelection({ missing_gps: true })).rejects.toThrow("db timeout");
  });
});

// Chains "awaitables": el builder de supabase es un thenable; acá cada chain resuelve
// a un resultado fijo (ids de dashboard) o eco de los ids pedidos (tabla leads).
function makeDashboardChain(ids: string[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve),
  };
  return chain;
}

function makeLeadsEchoChain() {
  let captured: string[] = [];
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    in: vi.fn((_col: string, ids: string[]) => {
      captured = ids;
      return chain;
    }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: captured.map((id) => ({ id, name: id, passed_filter: true })),
        error: null,
      }).then(resolve),
  };
  return chain;
}

function ids(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `id-${String(from + i).padStart(5, "0")}`);
}

describe("loadLeadsByFilterSelection — paginación y chunking para scope=all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pagina la query de ids más allá del max-rows de Supabase (1000) hasta el límite", async () => {
    const dashboardChains = [
      makeDashboardChain(ids(0, 1000)),
      makeDashboardChain(ids(1000, 1000)),
      makeDashboardChain(ids(2000, 500)),
    ];
    const leadsChains: ReturnType<typeof makeLeadsEchoChain>[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "lead_dashboard") return dashboardChains.shift();
      const chain = makeLeadsEchoChain();
      leadsChains.push(chain);
      return chain;
    });

    const leads = await loadLeadsByFilterSelection({ niche: "restaurante" }, { passedOnly: true, limit: 2500 });

    expect(leads).toHaveLength(2500);
    // 3 páginas de ids con range correlativo.
    expect((dashboardChains.length)).toBe(0);
    // Los leads se piden en lotes acotados (sin .in() gigante que rompa el límite de URL).
    expect(leadsChains.length).toBeGreaterThanOrEqual(Math.ceil(2500 / 250));
    for (const chain of leadsChains) {
      const inCalls = (chain.in as ReturnType<typeof vi.fn>).mock.calls;
      expect(inCalls).toHaveLength(1);
      expect((inCalls[0]![1] as string[]).length).toBeLessThanOrEqual(250);
    }
  });

  it("corta la paginación cuando una página viene incompleta (colección menor al límite)", async () => {
    const dashboardChains = [makeDashboardChain(ids(0, 80))];
    let leadsCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "lead_dashboard") return dashboardChains.shift();
      leadsCalls += 1;
      return makeLeadsEchoChain();
    });

    const leads = await loadLeadsByFilterSelection({ niche: "x" }, { passedOnly: true, limit: 10000 });

    expect(leads).toHaveLength(80);
    expect(dashboardChains.length).toBe(0);
    expect(leadsCalls).toBe(1);
  });

  it("respeta passedOnly en cada lote de leads", async () => {
    const dashboardChains = [makeDashboardChain(ids(0, 10))];
    const leadsChains: ReturnType<typeof makeLeadsEchoChain>[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "lead_dashboard") return dashboardChains.shift();
      const chain = makeLeadsEchoChain();
      leadsChains.push(chain);
      return chain;
    });

    await loadLeadsByFilterSelection({ niche: "x" }, { passedOnly: true, limit: 250 });

    expect(leadsChains.length).toBeGreaterThan(0);
    for (const chain of leadsChains) {
      expect(chain.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("passed_filter", true);
    }
  });
});
