import { describe, expect, it } from "vitest";
import { getCurrentStageDetail, getTrackingClientName, parseStageDetailDataInput, serializeStageDetailData } from "../../ui/src/lib/crm-case";
import type { LeadTrackingDetail } from "../../ui/src/lib/api";

describe("crm-case helpers", () => {
  it("returns visible client name or id fallback", () => {
    expect(getTrackingClientName({ lead_name: "Cliente Demo", lead_id: "12345678-1234-1234-1234-123456789abc" })).toBe("Cliente Demo");
    expect(getTrackingClientName({ lead_name: null, lead_id: "12345678-1234-1234-1234-123456789abc" })).toBe("12345678…");
  });

  it("resolves the current stage detail", () => {
    const detail = {
      status: "contact",
      stage_details: [
        { id: "1", tracking_id: "t1", stage: "pending", summary: "Inicio", data: {}, updated_by_user_id: "u1", created_at: "2026-01-01", updated_at: "2026-01-01" },
        { id: "2", tracking_id: "t1", stage: "contact", summary: "Actual", data: { owner: "qa" }, updated_by_user_id: "u1", created_at: "2026-01-01", updated_at: "2026-01-02" },
      ],
    } as LeadTrackingDetail;

    expect(getCurrentStageDetail(detail)?.id).toBe("2");
  });

  it("serializes and parses stage detail JSON safely", () => {
    expect(serializeStageDetailData({ ok: true })).toContain('"ok": true');
    expect(serializeStageDetailData({})).toBe("{}");
    expect(parseStageDetailDataInput("{\n  \"ok\": true\n}")).toEqual({ data: { ok: true }, error: null });
    expect(parseStageDetailDataInput("[]").error).toMatch(/objeto JSON/i);
    expect(parseStageDetailDataInput("{ nope").error).toMatch(/JSON válido/i);
  });
});
