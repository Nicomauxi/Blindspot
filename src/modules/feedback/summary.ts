export type FeedbackSummaryRow = {
  field_key: string;
  total: number;
  good_count: number;
  bad_count: number;
  latest_verdict: "good" | "bad";
  latest_comment: string | null;
  latest_at: string | null;
  latest_actor_user_id: string | null;
  latest_actor_role: string | null;
};

export type FeedbackAdjustedConfidence = {
  contact_reliability_score: number | null;
  data_confidence_score: number | null;
  contact_delta: number;
  data_delta: number;
  flagged_fields: string[];
  confirmed_fields: string[];
};

const CONTACT_FIELDS = new Set(["phone", "whatsapp", "email", "website", "instagram", "facebook"]);
const DATA_FIELDS = new Set(["name", "address", "business_status", "primary_offer", "niche"]);

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function summarizeFeedbackRows(rows: Array<Record<string, unknown>>): FeedbackSummaryRow[] {
  const summary = new Map<string, FeedbackSummaryRow>();

  for (const row of rows) {
    const fieldKey = typeof row["field_key"] === "string" ? row["field_key"] : null;
    const verdict = row["verdict"] === "good" || row["verdict"] === "bad" ? row["verdict"] : null;
    if (!fieldKey || !verdict) continue;

    const existing = summary.get(fieldKey);
    if (!existing) {
      summary.set(fieldKey, {
        field_key: fieldKey,
        total: 1,
        good_count: verdict === "good" ? 1 : 0,
        bad_count: verdict === "bad" ? 1 : 0,
        latest_verdict: verdict,
        latest_comment: typeof row["comment"] === "string" ? row["comment"] : null,
        latest_at: typeof row["created_at"] === "string" ? row["created_at"] : null,
        latest_actor_user_id: typeof row["actor_user_id"] === "string" ? row["actor_user_id"] : null,
        latest_actor_role: typeof row["actor_role"] === "string" ? row["actor_role"] : null,
      });
      continue;
    }

    existing.total += 1;
    if (verdict === "good") existing.good_count += 1;
    else existing.bad_count += 1;

    // Update latest_* only if this row is chronologically newer
    const thisAt = typeof row["created_at"] === "string" ? row["created_at"] : "";
    const existingAt = existing.latest_at ?? "";
    if (thisAt > existingAt) {
      existing.latest_verdict = verdict;
      existing.latest_comment = typeof row["comment"] === "string" ? row["comment"] : null;
      existing.latest_at = thisAt || null;
      existing.latest_actor_user_id = typeof row["actor_user_id"] === "string" ? row["actor_user_id"] : null;
      existing.latest_actor_role = typeof row["actor_role"] === "string" ? row["actor_role"] : null;
    }
  }

  return Array.from(summary.values()).sort((a, b) => a.field_key.localeCompare(b.field_key));
}

export function computeFeedbackAdjustedConfidence(params: {
  contactReliabilityScore: number | null;
  dataConfidenceScore: number | null;
  summary: FeedbackSummaryRow[];
}): FeedbackAdjustedConfidence {
  let contactDelta = 0;
  let dataDelta = 0;
  const flaggedFields: string[] = [];
  const confirmedFields: string[] = [];

  for (const entry of params.summary) {
    // N103: el delta lo decide el BALANCE de votos (no solo el último) — un campo con
    // 5 good y 1 bad reciente quedaba penalizado. Empate → desempata el último verdict.
    const balance = entry.bad_count - entry.good_count;
    const isBad = balance > 0 || (balance === 0 && entry.latest_verdict === "bad");
    if (isBad) flaggedFields.push(entry.field_key);
    else confirmedFields.push(entry.field_key);

    if (CONTACT_FIELDS.has(entry.field_key)) {
      contactDelta += isBad ? -0.15 : 0.05;
    }
    if (DATA_FIELDS.has(entry.field_key)) {
      dataDelta += isBad ? -0.1 : 0.03;
    }
  }

  return {
    contact_reliability_score:
      params.contactReliabilityScore == null ? null : clampScore(params.contactReliabilityScore + contactDelta),
    data_confidence_score:
      params.dataConfidenceScore == null ? null : clampScore(params.dataConfidenceScore + dataDelta),
    contact_delta: contactDelta,
    data_delta: dataDelta,
    flagged_fields: flaggedFields,
    confirmed_fields: confirmedFields,
  };
}
