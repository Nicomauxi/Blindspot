import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabase } from "../../src/shared/supabase.js";
import {
  detectAndSeedEmailProviders,
  detectAndSeedHeuristicDomains,
  loadAllRuntime,
  loadRuntimePatterns,
} from "../../src/storage/system-lists.js";

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(),
}));

describe("loadRuntimePatterns", () => {
  it("returns legacy keys and runtime aliases for platform patterns", async () => {
    const patterns = await loadRuntimePatterns();

    expect(patterns.delivery).toEqual(patterns.deliveryPlatforms);
    expect(patterns.reservation).toEqual(patterns.reservationPlatforms);
    expect(patterns.classBooking).toEqual(patterns.classBookingPlatforms);
    expect(patterns.appStore).toEqual(patterns.appStorePlatforms);
    expect(patterns.chatWidgets).toEqual(patterns.chatWidgetPatterns);
    expect(patterns.menuKeywords.length).toBeGreaterThan(0);
    expect(patterns.catalogKeywords.length).toBeGreaterThan(0);
  });
});

describe("loadAllRuntime", () => {
  it("exposes the runtime aliases expected by operational system parsing", async () => {
    const runtime = await loadAllRuntime();

    expect(runtime.patterns.deliveryPlatforms?.length).toBeGreaterThan(0);
    expect(runtime.patterns.menuKeywords?.length).toBeGreaterThan(0);
    expect(runtime.patterns.chatWidgetPatterns?.length).toBeGreaterThan(0);
    expect(runtime.patterns.reservationPlatforms?.length).toBeGreaterThan(0);
  });
});

describe("detectAndSeedEmailProviders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates email domains from passed leads, skips existing blocked domains, and inserts new ones", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const existingEq = vi.fn().mockResolvedValue({
      data: [{ value: "existing.com" }],
      error: null,
    });
    const existingSelect = vi.fn(() => ({ eq: existingEq }));
    const leadsNot = vi.fn().mockResolvedValue({
      data: [
        { id: "lead-1", emails: [" Sales@Repeat.com ", "hello@existing.com", "sales@repeat.com"] },
        { id: "lead-2", emails: ["team@repeat.com", "owner@newco.uy"] },
        { id: "lead-3", emails: ["team@newco.uy", "invalid-email", "", null] },
        { id: "lead-4", emails: ["other@ignored.com"] },
      ],
      error: null,
    });
    const leadsEq = vi.fn(() => ({ not: leadsNot }));
    const leadsSelect = vi.fn(() => ({ eq: leadsEq }));

    const from = vi.fn((table: string) => {
      if (table === "leads") return { select: leadsSelect };
      if (table === "system_lists") return { select: existingSelect, insert };
      throw new Error(`unexpected table ${table}`);
    });

    vi.mocked(getSupabase).mockReturnValue({ from } as never);

    const inserted = await detectAndSeedEmailProviders(2);

    expect(inserted).toBe(2);
    expect(from).toHaveBeenCalledWith("leads");
    expect(leadsSelect).toHaveBeenCalledWith("id, emails:digital_footprint->contact_emails");
    expect(leadsEq).toHaveBeenCalledWith("passed_filter", true);
    expect(leadsNot).toHaveBeenCalledWith("digital_footprint->contact_emails", "is", null);

    expect(from).toHaveBeenCalledWith("system_lists");
    expect(existingSelect).toHaveBeenCalledWith("value");
    expect(existingEq).toHaveBeenCalledWith("list_name", "blocked_email_domains");

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        list_name: "blocked_email_domains",
        value: "repeat.com",
        source: "auto_detected",
        confidence: 0.2,
      }),
      expect.objectContaining({
        list_name: "blocked_email_domains",
        value: "newco.uy",
        source: "auto_detected",
        confidence: 0.2,
      }),
    ]);
  });
});

describe("detectAndSeedHeuristicDomains", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates shared heuristic domains from distinct passed leads, skips existing domains, and inserts new ones", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const existingEq = vi.fn().mockResolvedValue({
      data: [{ value: "existing.uy" }],
      error: null,
    });
    const existingSelect = vi.fn(() => ({ eq: existingEq }));
    const leadsNot = vi.fn().mockResolvedValue({
      data: [
        { id: "lead-1", heuristic_url: "https://www.repeat.com.uy" },
        { id: "lead-2", heuristic_url: "https://repeat.uy" },
        { id: "lead-2", heuristic_url: "https://repeat.uy" },
        { id: "lead-3", heuristic_url: "https://existing.com.uy" },
        { id: "lead-4", heuristic_url: "https://existing.uy" },
        { id: "lead-5", heuristic_url: "https://solo.com.uy" },
        { id: "lead-6", heuristic_url: "notaurl" },
      ],
      error: null,
    });
    const leadsEq = vi.fn(() => ({ not: leadsNot }));
    const leadsSelect = vi.fn(() => ({ eq: leadsEq }));

    const from = vi.fn((table: string) => {
      if (table === "leads") return { select: leadsSelect };
      if (table === "system_lists") return { select: existingSelect, insert };
      throw new Error(`unexpected table ${table}`);
    });

    vi.mocked(getSupabase).mockReturnValue({ from } as never);

    const inserted = await detectAndSeedHeuristicDomains(2);

    expect(inserted).toBe(1);
    expect(from).toHaveBeenCalledWith("leads");
    expect(leadsSelect).toHaveBeenCalledWith("id, heuristic_url:digital_footprint->heuristic_discovery->selected->website->>url");
    expect(leadsEq).toHaveBeenCalledWith("passed_filter", true);
    expect(leadsNot).toHaveBeenCalledWith("digital_footprint->heuristic_discovery->selected->website->>url", "is", null);

    expect(from).toHaveBeenCalledWith("system_lists");
    expect(existingSelect).toHaveBeenCalledWith("value");
    expect(existingEq).toHaveBeenCalledWith("list_name", "blocked_heuristic_domains");

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        list_name: "blocked_heuristic_domains",
        value: "repeat.uy",
        source: "auto_detected",
        confidence: 0.2,
      }),
    ]);
  });
});
