import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { createAlert, markAlertRead, archiveAlert } from "../../src/storage/alerts.js";

function makeAlert(overrides = {}) {
  return {
    id: "alert-1",
    kind: "gp_budget_threshold",
    severity: "warn",
    title: "Test alert",
    description: "Test description",
    payload: null,
    target_user_id: null,
    status: "pending",
    created_at: "2026-05-24T00:00:00Z",
    read_at: null,
    read_by: null,
    dedup_key: null,
    ...overrides,
  };
}

function makeInsertChain(row: unknown) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const sel = vi.fn().mockReturnValue({ single });
  const ins = vi.fn().mockReturnValue({ select: sel });
  return { insert: ins, single };
}

function makeSelectChain(row: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue({ maybeSingle }),
    maybeSingle,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.neq.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  void limit;
  return chain;
}

function makeUpdateChain(error: null | { message: string } = null) {
  const terminal = Promise.resolve({ error });
  const chain: Record<string, unknown> = {
    then: terminal.then.bind(terminal),
    catch: terminal.catch.bind(terminal),
  };
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  return chain as { update: ReturnType<typeof vi.fn> };
}

describe("createAlert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns created alert on success", async () => {
    const insertChain = makeInsertChain(makeAlert());
    const selectChain = makeSelectChain(null); // no dedup match
    mockFrom.mockReturnValue({ ...selectChain, ...insertChain });

    const alert = await createAlert({
      kind: "gp_budget_threshold",
      severity: "warn",
      title: "Budget exceeded",
      description: "USD 200 spent",
    });
    expect(alert).not.toBeNull();
    expect(alert?.kind).toBe("gp_budget_threshold");
  });

  it("returns null when dedup_key matches a recent alert", async () => {
    const selectChain = makeSelectChain({ id: "existing-alert" });
    mockFrom.mockReturnValue(selectChain);

    const alert = await createAlert({
      kind: "gp_budget_threshold",
      severity: "warn",
      title: "Budget exceeded",
      description: "USD 200 spent",
      dedup_key: "gp_budget_threshold:over_budget",
    });
    expect(alert).toBeNull();
  });

  it("throws when DB insert fails", async () => {
    const selectChain = makeSelectChain(null);
    const failSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
    const failSel = vi.fn().mockReturnValue({ single: failSingle });
    const failIns = vi.fn().mockReturnValue({ select: failSel });
    mockFrom.mockReturnValue({ ...selectChain, insert: failIns });

    await expect(
      createAlert({ kind: "test", severity: "info", title: "T", description: "D" })
    ).rejects.toThrow("createAlert failed: DB error");
  });
});

describe("markAlertRead", () => {
  it("resolves without error on success", async () => {
    const { update } = makeUpdateChain(null);
    mockFrom.mockReturnValue({ update });
    await expect(markAlertRead("alert-1", "user-1")).resolves.toBeUndefined();
  });

  it("throws when DB update fails", async () => {
    const { update } = makeUpdateChain({ message: "update failed" });
    mockFrom.mockReturnValue({ update });
    await expect(markAlertRead("alert-1", "user-1")).rejects.toThrow("markAlertRead failed: update failed");
  });
});

describe("archiveAlert", () => {
  it("resolves without error on success", async () => {
    const { update } = makeUpdateChain(null);
    mockFrom.mockReturnValue({ update });
    await expect(archiveAlert("alert-1", "user-1")).resolves.toBeUndefined();
  });

  it("throws when DB update fails", async () => {
    const { update } = makeUpdateChain({ message: "archive failed" });
    mockFrom.mockReturnValue({ update });
    await expect(archiveAlert("alert-1", "user-1")).rejects.toThrow("archiveAlert failed: archive failed");
  });
});
