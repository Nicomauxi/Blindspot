import type { CrmStatus, LeadTracking } from "@/lib/api";

export const CRM_COLUMNS: { status: CrmStatus; label: string; color: string }[] = [
  { status: "pending",    label: "Pendiente",   color: "bg-slate-100 text-slate-700" },
  { status: "validation", label: "Validación",  color: "bg-amber-100 text-amber-800" },
  { status: "contact",    label: "Contacto",    color: "bg-sky-100 text-sky-800" },
  { status: "observed",   label: "Observado",   color: "bg-violet-100 text-violet-800" },
  { status: "rejected",   label: "Rechazado",   color: "bg-rose-100 text-rose-700" },
  { status: "accepted",   label: "Aceptado",    color: "bg-emerald-100 text-emerald-800" },
];

export const VALID_TRANSITIONS: Record<CrmStatus, CrmStatus[]> = {
  pending:    ["validation", "rejected"],
  validation: ["pending", "contact", "rejected"],
  contact:    ["validation", "observed", "accepted", "rejected"],
  observed:   ["contact", "accepted", "rejected"],
  rejected:   ["validation"],
  accepted:   ["validation"],
};

export const STATUS_ORDER: Record<CrmStatus, number> = {
  pending:    0,
  validation: 1,
  contact:    2,
  observed:   3,
  rejected:   4,
  accepted:   4,
};

export function isTerminalStatus(status: CrmStatus): boolean {
  return status === "rejected" || status === "accepted";
}

export function isRegressionTransition(from: CrmStatus, to: CrmStatus): boolean {
  return STATUS_ORDER[to] < STATUS_ORDER[from];
}

export function groupTrackingsByStatus(
  trackings: LeadTracking[],
  ownerFilter?: string
): Record<CrmStatus, LeadTracking[]> {
  const result: Record<CrmStatus, LeadTracking[]> = {
    pending: [],
    validation: [],
    contact: [],
    observed: [],
    rejected: [],
    accepted: [],
  };

  for (const t of trackings) {
    if (ownerFilter && t.owner_id !== ownerFilter) continue;
    result[t.status]?.push(t);
  }

  return result;
}
