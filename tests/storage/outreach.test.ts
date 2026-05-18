import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

import { getOutreachStats } from "../../src/storage/outreach.js";

type OutreachRow = {
  status: string;
  channel: string;
  outcome: string | null;
  responded: boolean | null;
};

function mockSelect(rows: OutreachRow[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
  });
}

describe("getOutreachStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeroes when no records", async () => {
    mockSelect([]);
    const stats = await getOutreachStats();
    expect(stats.total).toBe(0);
    expect(stats.conversion_rate).toBe(0);
    expect(stats.response_rate).toBe(0);
    expect(stats.by_status).toEqual({});
  });

  it("counts by_status correctly", async () => {
    mockSelect([
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
      { status: "interested", channel: "whatsapp", outcome: null, responded: true },
    ]);
    const stats = await getOutreachStats();
    expect(stats.total).toBe(3);
    expect(stats.by_status["contacted"]).toBe(2);
    expect(stats.by_status["interested"]).toBe(1);
  });

  it("counts by_channel correctly", async () => {
    mockSelect([
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
      { status: "contacted", channel: "email", outcome: null, responded: false },
      { status: "closed_won", channel: "whatsapp", outcome: "closed_won", responded: true },
    ]);
    const stats = await getOutreachStats();
    expect(stats.by_channel["whatsapp"]).toBe(2);
    expect(stats.by_channel["email"]).toBe(1);
  });

  it("computes conversion_rate correctly", async () => {
    mockSelect([
      { status: "closed_won", channel: "whatsapp", outcome: "closed_won", responded: true },
      { status: "closed_lost", channel: "whatsapp", outcome: "closed_lost", responded: true },
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
    ]);
    const stats = await getOutreachStats();
    expect(stats.total).toBe(4);
    expect(stats.conversion_rate).toBeCloseTo(0.25);
  });

  it("computes response_rate correctly", async () => {
    mockSelect([
      { status: "responded", channel: "whatsapp", outcome: null, responded: true },
      { status: "responded", channel: "whatsapp", outcome: null, responded: true },
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
    ]);
    const stats = await getOutreachStats();
    expect(stats.response_rate).toBeCloseTo(2 / 3);
  });

  it("counts by_outcome correctly (skips null outcomes)", async () => {
    mockSelect([
      { status: "closed_won", channel: "whatsapp", outcome: "closed_won", responded: true },
      { status: "closed_lost", channel: "whatsapp", outcome: "closed_lost", responded: false },
      { status: "contacted", channel: "whatsapp", outcome: null, responded: false },
    ]);
    const stats = await getOutreachStats();
    expect(stats.by_outcome["closed_won"]).toBe(1);
    expect(stats.by_outcome["closed_lost"]).toBe(1);
    expect("null" in stats.by_outcome).toBe(false);
  });

  it("throws on DB error", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: "DB connection error" } }),
    });
    await expect(getOutreachStats()).rejects.toThrow("DB connection error");
  });
});
