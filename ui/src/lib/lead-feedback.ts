import type { LeadDetail, LeadFeedbackEntry, LeadFeedbackSummaryEntry } from "@/lib/api";

export type LeadFeedbackFieldOption = {
  key: string;
  label: string;
  value: string;
};

const COMMON_FIELD_LABELS: Record<string, string> = {
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Email",
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  address: "Dirección",
  business_status: "Estado del negocio",
  primary_offer: "Oferta principal",
  notes: "Notas",
};

function asDisplayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

export function resolveLeadFeedbackFieldValue(lead: LeadDetail | null, fieldKey: string): string {
  if (!lead || !fieldKey) return "";

  const directValue = asDisplayValue((lead as Record<string, unknown>)[fieldKey]);
  if (directValue) return directValue;

  const canonicalValue = asDisplayValue(
    (lead.canonical_fields?.[fieldKey] as { value?: unknown } | undefined)?.value
  );
  if (canonicalValue) return canonicalValue;

  const fieldSourceValue = asDisplayValue(lead.field_sources?.[fieldKey]?.value);
  if (fieldSourceValue) return fieldSourceValue;

  return "";
}

export function buildLeadFeedbackFieldOptions(lead: LeadDetail | null): LeadFeedbackFieldOption[] {
  if (!lead) return [];

  const candidateKeys = new Set<string>([
    ...Object.keys(COMMON_FIELD_LABELS),
    ...Object.keys(lead.field_sources ?? {}),
    ...Object.keys(lead.canonical_fields ?? {}),
  ]);

  return Array.from(candidateKeys)
    .map((key) => {
      const value = resolveLeadFeedbackFieldValue(lead, key);
      if (!value) return null;
      return {
        key,
        label: COMMON_FIELD_LABELS[key] ?? key.replace(/[_-]+/g, " "),
        value,
      };
    })
    .filter((option): option is LeadFeedbackFieldOption => option !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function mergeLeadFeedbackSummary(
  summary: LeadFeedbackSummaryEntry[],
  created: LeadFeedbackEntry
): LeadFeedbackSummaryEntry[] {
  const existing = summary.find((entry) => entry.field_key === created.field_key);
  if (!existing) {
    return [
      ...summary,
      {
        field_key: created.field_key,
        total: 1,
        good_count: created.verdict === "good" ? 1 : 0,
        bad_count: created.verdict === "bad" ? 1 : 0,
        latest_verdict: created.verdict,
        latest_comment: created.comment,
        latest_at: created.created_at,
        latest_actor_user_id: created.actor_user_id,
        latest_actor_role: created.actor_role,
      },
    ].sort((a, b) => a.field_key.localeCompare(b.field_key));
  }

  return summary.map((entry) => {
    if (entry.field_key !== created.field_key) return entry;
    return {
      ...entry,
      total: entry.total + 1,
      good_count: entry.good_count + (created.verdict === "good" ? 1 : 0),
      bad_count: entry.bad_count + (created.verdict === "bad" ? 1 : 0),
      latest_verdict: created.verdict,
      latest_comment: created.comment,
      latest_at: created.created_at,
      latest_actor_user_id: created.actor_user_id,
      latest_actor_role: created.actor_role,
    };
  });
}
