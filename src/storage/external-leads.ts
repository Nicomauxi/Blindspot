import { getSupabase } from "../shared/supabase.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../shared/types.js";
import { calculateContactReliability, calculateDataConfidence } from "../modules/scoring/confidence.js";

interface InsertExternalLeadOpts {
  dryRun?: boolean;
  extraTags?: string[];
}

interface CanonicalFieldValue {
  value: string;
  confidence: number;
  sources: string[];
  conflict: boolean;
}

export async function insertExternalLead(
  candidate: DiscoveryCandidate,
  opts: InsertExternalLeadOpts = {}
): Promise<Lead | null> {
  if (opts.dryRun) return null;

  const db = getSupabase();
  const placeId = `${candidate.source}:${candidate.external_id}`;

  const { data, error } = await db
    .from("leads")
    .upsert(
      {
        place_id: placeId,
        source: candidate.source,
        external_id: candidate.external_id,
        source_confidence: candidate.source_confidence,
        source_data: candidate.raw,
        name: candidate.name,
        address: candidate.address,
        phone: candidate.phone,
        website: candidate.website,
        niche: candidate.niche ?? "other",
        state: "discovered",
        passed_filter: true,
        rejection_reasons: [],
        tags: opts.extraTags ?? [],
      },
      { onConflict: "place_id", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`insertExternalLead failed: ${error.message}`);
  const lead = data as Lead;

  if (candidate.email) {
    const existing = (lead.canonical_fields ?? {}) as Record<string, unknown>;
    await db
      .from("leads")
      .update({ canonical_fields: { ...existing, email: candidate.email } })
      .eq("id", lead.id);
  }

  return lead;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function canonicalFieldEntry(value: unknown): CanonicalFieldValue | null {
  if (typeof value === "string") {
    return {
      value,
      confidence: 0.5,
      sources: [],
      conflict: false,
    };
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    const field = value as {
      value: string;
      confidence?: number;
      sources?: unknown[];
      conflict?: boolean;
    };
    const sources = Array.isArray(field.sources)
      ? field.sources.filter((source): source is string => typeof source === "string")
      : [];

    return {
      value: field.value,
      confidence: typeof field.confidence === "number" ? field.confidence : 0.5,
      sources,
      conflict: field.conflict === true,
    };
  }

  return null;
}

function normalizeComparableValue(field: "phone" | "website" | "email", value: string): string {
  const trimmed = value.trim();
  if (field === "phone") return trimmed.replace(/\D/g, "");

  if (field === "website") {
    try {
      const url = new URL(trimmed);
      url.hash = "";
      url.search = "";
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return trimmed.toLowerCase().replace(/\/+$/, "");
    }
  }

  return trimmed.toLowerCase();
}

function buildCanonicalField(
  lead: Lead,
  field: "phone" | "website" | "email",
  candidate: DiscoveryCandidate,
  candidateValue: string | null
): CanonicalFieldValue | null {
  const existingField = canonicalFieldEntry(lead.canonical_fields?.[field]);
  const existingValue =
    existingField?.value ??
    (field === "phone" ? lead.phone : field === "website" ? lead.website : null);

  if (!existingValue && !candidateValue) return null;
  if (!existingValue && candidateValue) {
    return {
      value: candidateValue,
      confidence: round2(Math.min(0.95, candidate.source_confidence)),
      sources: [candidate.source],
      conflict: false,
    };
  }

  if (!candidateValue && existingField) return existingField;
  if (!candidateValue && existingValue) {
    return {
      value: existingValue,
      confidence: round2(Math.min(0.95, lead.source_confidence ?? 0.5)),
      sources: existingField?.sources.length ? existingField.sources : [lead.source],
      conflict: existingField?.conflict ?? false,
    };
  }

  const safeExistingValue = existingValue ?? "";
  const safeCandidateValue = candidateValue ?? "";
  const sameValue = normalizeComparableValue(field, safeExistingValue) ===
    normalizeComparableValue(field, safeCandidateValue);

  if (sameValue) {
    const sources = Array.from(new Set([
      ...(existingField?.sources.length ? existingField.sources : [lead.source]),
      candidate.source,
    ]));

    return {
      value: safeExistingValue,
      confidence: round2(Math.min(0.95, (lead.source_confidence ?? 0.5) + ((sources.length - 1) * 0.15))),
      sources,
      conflict: false,
    };
  }

  const existingConfidence = existingField?.confidence ?? (lead.source_confidence ?? 0.5);
  const useCandidate = candidate.source_confidence > existingConfidence;
  const winnerValue = useCandidate ? safeCandidateValue : safeExistingValue;
  const winnerSources = useCandidate
    ? [candidate.source]
    : (existingField?.sources.length ? existingField.sources : [lead.source]);

  return {
    value: winnerValue,
    confidence: round2(Math.min(0.95, Math.max(existingConfidence, candidate.source_confidence))),
    sources: Array.from(new Set(winnerSources)),
    conflict: true,
  };
}

function mergeCanonicalFields(
  lead: Lead,
  candidate: DiscoveryCandidate
): Record<string, unknown> | null {
  const nextFields: Record<string, unknown> = {
    ...((lead.canonical_fields ?? {}) as Record<string, unknown>),
  };

  const phone = buildCanonicalField(lead, "phone", candidate, candidate.phone);
  const website = buildCanonicalField(lead, "website", candidate, candidate.website);
  const email = buildCanonicalField(lead, "email", candidate, candidate.email);

  if (phone) nextFields.phone = phone;
  if (website) nextFields.website = website;
  if (email) nextFields.email = email;

  return Object.keys(nextFields).length > 0 ? nextFields : null;
}

export async function addCorroboratingSource(
  leadId: string,
  candidate: DiscoveryCandidate,
  opts: { dryRun?: boolean } = {}
): Promise<Lead | null> {
  if (opts.dryRun) return null;

  const db = getSupabase();
  const seenAt = new Date().toISOString();

  const { data: leadRow, error: fetchError } = await db
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (fetchError) throw new Error(`addCorroboratingSource lead fetch failed: ${fetchError.message}`);

  const lead = leadRow as Lead;
  const existing: CorroboratingSource[] = lead.corroborating_sources ?? [];
  if (existing.some((source) => source.source === candidate.source)) return lead;

  const newSource: CorroboratingSource = {
    source: candidate.source,
    external_id: candidate.external_id,
    seen_at: seenAt,
    confidence: candidate.source_confidence,
  };
  const corroboratingSources = [...existing, newSource];
  const canonicalFields = mergeCanonicalFields(lead, candidate);
  const mergedLead: Lead = {
    ...lead,
    canonical_fields: canonicalFields,
    corroborating_sources: corroboratingSources,
  };
  const dataConfidenceScore = calculateDataConfidence(mergedLead);
  const contactReliabilityScore = calculateContactReliability(mergedLead);

  const { data, error: updateError } = await db
    .rpc("merge_corroborating_source", {
      p_lead_id: leadId,
      p_source: candidate.source,
      p_external_id: candidate.external_id,
      p_source_confidence: candidate.source_confidence,
      p_raw_data: candidate.raw,
      p_corroborating_sources: corroboratingSources,
      p_canonical_fields: canonicalFields,
      p_data_confidence_score: dataConfidenceScore,
      p_contact_reliability_score: contactReliabilityScore,
    })
    .single();

  if (updateError) throw new Error(`addCorroboratingSource update failed: ${updateError.message}`);
  return data as Lead;
}
