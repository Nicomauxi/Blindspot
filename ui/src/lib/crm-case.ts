import type { LeadTracking, LeadTrackingDetail, LeadTrackingStageDetail } from "@/lib/api";

export function getTrackingClientName(tracking: Pick<LeadTracking, "lead_name" | "lead_id">): string {
  return tracking.lead_name?.trim() || `${tracking.lead_id.slice(0, 8)}…`;
}

export function getCurrentStageDetail(detail: LeadTrackingDetail): LeadTrackingStageDetail | null {
  return detail.stage_details.find((item) => item.stage === detail.status) ?? null;
}

export function serializeStageDetailData(data: Record<string, unknown> | null | undefined): string {
  if (!data || Object.keys(data).length === 0) {
    return "{}";
  }

  return JSON.stringify(data, null, 2);
}

export function parseStageDetailDataInput(raw: string): { data: Record<string, unknown>; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { data: {}, error: null };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return { data: {}, error: "Los datos avanzados deben ser un objeto JSON." };
    }
    return { data: parsed as Record<string, unknown>, error: null };
  } catch {
    return { data: {}, error: "Los datos avanzados no tienen JSON válido." };
  }
}
