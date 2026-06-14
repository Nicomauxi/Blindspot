import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as null | { message: string },
  createAlert: vi.fn(async () => ({ id: "alert-1" })),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "not", "lte", "gte", "in"]) chain[m] = vi.fn(() => chain);
      chain["limit"] = vi.fn(async () => ({ data: mocks.rows, error: mocks.error }));
      return chain;
    },
  }),
}));

vi.mock("../../src/storage/alerts.js", () => ({
  createAlert: mocks.createAlert,
}));

import { processDueCrmReminders } from "../../src/modules/crm/reminder-alerts.js";

describe("processDueCrmReminders (N27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.error = null;
  });

  it("crea una alerta dirigida al owner por cada reminder vencido", async () => {
    mocks.rows = [
      {
        id: "evt-1",
        tracking_id: "trk-1",
        reminder_at: "2026-06-12T10:00:00Z",
        notes: "Llamar después de las 14",
        lead_tracking: { owner_id: "cm-1", status: "contact", title: "Panadería X", case_code: "CRM-000007", lead_id: "lead-1" },
      },
    ];

    const created = await processDueCrmReminders(new Date("2026-06-12T12:00:00Z"));

    expect(created).toBe(1);
    expect(mocks.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "crm_reminder_due",
        target_user_id: "cm-1",
        dedup_key: "crm_reminder_due:evt-1",
      })
    );
  });

  it("sin reminders vencidos no crea nada", async () => {
    const created = await processDueCrmReminders();
    expect(created).toBe(0);
    expect(mocks.createAlert).not.toHaveBeenCalled();
  });

  it("error de query degrada a 0 sin lanzar", async () => {
    mocks.error = { message: "boom" };
    await expect(processDueCrmReminders()).resolves.toBe(0);
  });
});
