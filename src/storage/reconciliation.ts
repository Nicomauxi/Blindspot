import { getSupabase } from "../shared/supabase.js";
import type { CorroboratingSource, DiscoveryCandidate, DiscoverySource, Lead } from "../shared/types.js";
import { calculateContactReliability, calculateDataConfidence } from "../modules/scoring/confidence.js";
import { parseLeadGps } from "../modules/discovery/geo-text.js";

interface LeadSourceReferenceRow {
  lead_id: string;
  source: DiscoverySource;
  external_id: string | null;
  source_confidence: number | null;
  raw_data: Record<string, unknown> | null;
  seen_at: string;
}

interface LeadFieldEvidenceRow {
  lead_id: string;
  field_name: string;
  value: string;
  sources: string[];
  confidence: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

interface CanonicalFieldValue {
  value: string;
  confidence: number;
  sources: string[];
  conflict: boolean;
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

  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
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
  const sameValue =
    normalizeComparableValue(field, safeExistingValue) === normalizeComparableValue(field, safeCandidateValue);

  if (sameValue) {
    const sources = Array.from(new Set([
      ...(existingField?.sources.length ? existingField.sources : [lead.source]),
      candidate.source,
    ]));

    return {
      value: safeExistingValue,
      confidence: round2(
        Math.min(0.95, (lead.source_confidence ?? 0.5) + ((sources.length - 1) * 0.15))
      ),
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

function canonicalFieldValue(canonicalFields: Lead["canonical_fields"], field: "phone" | "website" | "email"): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;
  const raw = canonicalFields[field];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof raw.value === "string") {
    return raw.value;
  }
  return null;
}

function leadToCandidate(lead: Lead): DiscoveryCandidate {
  const gps = parseLeadGps(lead.gps);
  return {
    source: lead.source,
    external_id: lead.external_id ?? lead.place_id,
    source_confidence: lead.source_confidence ?? 0.5,
    name: lead.name,
    address: lead.address,
    phone: canonicalFieldValue(lead.canonical_fields, "phone") ?? lead.phone,
    website: canonicalFieldValue(lead.canonical_fields, "website") ?? lead.website,
    email: canonicalFieldValue(lead.canonical_fields, "email"),
    latitude: gps?.lat ?? null,
    longitude: gps?.lng ?? null,
    niche: lead.niche,
    raw: lead.source_data ?? {},
  };
}

function computeCanonicalSource(
  primarySource: string,
  primaryConfidence: number,
  corroboratingSources: CorroboratingSource[]
): string {
  let best = { source: primarySource, confidence: primaryConfidence };
  for (const cs of corroboratingSources) {
    if (cs.confidence > best.confidence) {
      best = { source: cs.source, confidence: cs.confidence };
    }
  }
  return best.source;
}

function dedupeCorroboratingSources(
  sources: CorroboratingSource[]
): CorroboratingSource[] {
  const merged = new Map<string, CorroboratingSource>();

  for (const source of sources) {
    const existing = merged.get(source.source);
    if (!existing) {
      merged.set(source.source, source);
      continue;
    }

    merged.set(source.source, {
      source: source.source,
      ...((existing.external_id ?? source.external_id) !== undefined
        ? { external_id: existing.external_id ?? source.external_id }
        : {}),
      seen_at: existing.seen_at > source.seen_at ? existing.seen_at : source.seen_at,
      confidence: Math.max(existing.confidence, source.confidence),
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.source.localeCompare(b.source));
}

function sourceReferenceFromLead(lead: Lead): LeadSourceReferenceRow {
  return {
    lead_id: lead.id,
    source: lead.source,
    external_id: lead.external_id,
    source_confidence: lead.source_confidence ?? null,
    raw_data: lead.source_data ?? null,
    seen_at: lead.updated_at,
  };
}

function corroboratingSourceFromReference(row: LeadSourceReferenceRow): CorroboratingSource {
  return {
    source: row.source,
    ...(row.external_id !== null ? { external_id: row.external_id } : {}),
    seen_at: row.seen_at,
    confidence: row.source_confidence ?? 0.5,
  };
}

function mergeFieldEvidenceRows(
  primaryLeadId: string,
  rows: LeadFieldEvidenceRow[]
): LeadFieldEvidenceRow[] {
  const merged = new Map<string, LeadFieldEvidenceRow>();

  for (const row of rows) {
    const key = `${row.field_name}::${row.value}`;
    const existing = merged.get(key);
    if (!existing) {
      // Omitimos `id` (igual que en source refs): el upsert genera el uuid por default.
      merged.set(key, {
        lead_id: primaryLeadId,
        field_name: row.field_name,
        value: row.value,
        sources: row.sources,
        confidence: row.confidence,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      });
      continue;
    }

    merged.set(key, {
      lead_id: primaryLeadId,
      field_name: row.field_name,
      value: row.value,
      sources: Array.from(new Set([...existing.sources, ...row.sources])).sort(),
      confidence: Math.max(existing.confidence ?? 0, row.confidence ?? 0) || null,
      first_seen: [existing.first_seen, row.first_seen].filter(Boolean).sort()[0] ?? null,
      last_seen: [existing.last_seen, row.last_seen].filter(Boolean).sort().slice(-1)[0] ?? null,
    });
  }

  return Array.from(merged.values());
}

async function fetchLead(leadId: string): Promise<Lead> {
  const { data, error } = await getSupabase()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (error) throw new Error(`fetchLead failed for ${leadId}: ${error.message}`);
  return data as Lead;
}

async function fetchSourceReferences(leadId: string): Promise<LeadSourceReferenceRow[]> {
  const { data, error } = await getSupabase()
    .from("lead_source_references")
    .select("*")
    .eq("lead_id", leadId);

  if (error) throw new Error(`fetchSourceReferences failed for ${leadId}: ${error.message}`);
  return (data ?? []) as LeadSourceReferenceRow[];
}

async function fetchFieldEvidences(leadId: string): Promise<LeadFieldEvidenceRow[]> {
  const { data, error } = await getSupabase()
    .from("lead_field_evidences")
    .select("*")
    .eq("lead_id", leadId);

  if (error) throw new Error(`fetchFieldEvidences failed for ${leadId}: ${error.message}`);
  return (data ?? []) as LeadFieldEvidenceRow[];
}

export async function reconcileLeadIntoPrimary(
  primaryLeadId: string,
  secondaryLeadId: string
): Promise<Lead> {
  if (primaryLeadId === secondaryLeadId) {
    throw new Error("reconcileLeadIntoPrimary requires different lead ids");
  }

  const db = getSupabase();
  const [primaryLead, secondaryLead, primaryRefs, secondaryRefs, primaryEvidence, secondaryEvidence] = await Promise.all([
    fetchLead(primaryLeadId),
    fetchLead(secondaryLeadId),
    fetchSourceReferences(primaryLeadId),
    fetchSourceReferences(secondaryLeadId),
    fetchFieldEvidences(primaryLeadId),
    fetchFieldEvidences(secondaryLeadId),
  ]);

  const secondaryCandidate = leadToCandidate(secondaryLead);
  const canonicalFields = mergeCanonicalFields(primaryLead, secondaryCandidate);

  const transferredRefs = dedupeCorroboratingSources(
    [sourceReferenceFromLead(secondaryLead), ...secondaryRefs]
      .filter((row) => row.source !== primaryLead.source)
      .map(corroboratingSourceFromReference)
  );

  const corroboratingSources = dedupeCorroboratingSources([
    ...(primaryLead.corroborating_sources ?? []),
    ...(secondaryLead.corroborating_sources ?? []),
    ...transferredRefs,
  ].filter((source) => source.source !== primaryLead.source));

  const canonicalSource = computeCanonicalSource(
    primaryLead.source,
    primaryLead.source_confidence ?? 0.5,
    corroboratingSources
  );

  const mergedLead: Lead = {
    ...primaryLead,
    canonical_fields: canonicalFields,
    corroborating_sources: corroboratingSources,
    canonical_source: canonicalSource,
  };
  const dataConfidenceScore = calculateDataConfidence(mergedLead);
  const contactReliabilityScore = calculateContactReliability(mergedLead);

  // Se omite `id` deliberadamente: las filas sintéticas no lo tienen y, al hacer
  // upsert, pasar `id: null` viola el NOT NULL (el default gen_random_uuid solo
  // aplica cuando la columna se omite). El conflicto se resuelve por (lead_id, source).
  // Dedup por source: el upsert resuelve conflictos por (lead_id, source), así que
  // no puede recibir dos filas de la misma source en el mismo batch ("cannot affect
  // row a second time"). Conservamos la de mayor confianza (y la más reciente).
  const sourceRefByKey = new Map<string, LeadSourceReferenceRow>();
  for (const row of [sourceReferenceFromLead(secondaryLead), ...secondaryRefs, ...primaryRefs]) {
    if (row.source === primaryLead.source) continue;
    const existing = sourceRefByKey.get(row.source);
    if (
      !existing ||
      (row.source_confidence ?? 0) > (existing.source_confidence ?? 0) ||
      ((row.source_confidence ?? 0) === (existing.source_confidence ?? 0) && row.seen_at > existing.seen_at)
    ) {
      sourceRefByKey.set(row.source, row);
    }
  }
  const mergedSourceRefs = Array.from(sourceRefByKey.values()).map((row) => ({
    lead_id: primaryLeadId,
    source: row.source,
    external_id: row.external_id,
    source_confidence: row.source_confidence,
    raw_data: row.raw_data,
    seen_at: row.seen_at,
  }));

  if (mergedSourceRefs.length > 0) {
    const { error } = await db
      .from("lead_source_references")
      .upsert(mergedSourceRefs, { onConflict: "lead_id,source" });
    if (error) throw new Error(`lead_source_references upsert failed: ${error.message}`);
  }

  const mergedFieldEvidences = mergeFieldEvidenceRows(primaryLeadId, [
    ...primaryEvidence,
    ...secondaryEvidence,
  ]);
  if (mergedFieldEvidences.length > 0) {
    const { error } = await db
      .from("lead_field_evidences")
      .upsert(mergedFieldEvidences, { onConflict: "lead_id,field_name,value" });
    if (error) throw new Error(`lead_field_evidences upsert failed: ${error.message}`);
  }

  // Transferir GPS del secundario al primario si éste no tenía coordenadas.
  // Preserva la mejor señal de cruce cuando el primario es una fuente sin GPS
  // (ej. mintur/yelu) que absorbe un secundario con coordenadas (ej. osm).
  const primaryGps = parseLeadGps(primaryLead.gps);
  const secondaryGps = parseLeadGps(secondaryLead.gps);
  const gpsTransfer =
    primaryGps == null && secondaryGps != null
      ? { gps: `SRID=4326;POINT(${secondaryGps.lng} ${secondaryGps.lat})` }
      : {};

  const { error: updateError } = await db
    .from("leads")
    .update({
      canonical_fields: canonicalFields,
      corroborating_sources: corroboratingSources,
      canonical_source: canonicalSource,
      data_confidence_score: dataConfidenceScore,
      contact_reliability_score: contactReliabilityScore,
      ...gpsTransfer,
      updated_at: new Date().toISOString(),
    })
    .eq("id", primaryLeadId);
  if (updateError) throw new Error(`primary lead update failed: ${updateError.message}`);

  const { error: deleteError } = await db
    .from("leads")
    .delete()
    .eq("id", secondaryLeadId);
  if (deleteError) throw new Error(`secondary lead delete failed: ${deleteError.message}`);

  return fetchLead(primaryLeadId);
}
