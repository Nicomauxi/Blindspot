import { getSupabase } from "../shared/supabase.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../shared/types.js";
import { calculateContactReliability, calculateDataConfidence } from "../modules/scoring/confidence.js";
import { isValidCoord } from "../modules/discovery/geo-text.js";
import { isForeignAddress } from "../modules/discovery/geo-validator.js";
import { candidateHasContact, qualifyExternalLead } from "../modules/discovery/qualification.js";
import { mergeCanonicalFields } from "./canonical-field.js";

interface InsertExternalLeadOpts {
  dryRun?: boolean;
  extraTags?: string[];
}

export async function insertExternalLead(
  candidate: DiscoveryCandidate,
  opts: InsertExternalLeadOpts = {}
): Promise<Lead | null> {
  if (opts.dryRun) return null;

  const db = getSupabase();
  const placeId = `${candidate.source}:${candidate.external_id}`;

  // Gate de calidad: un lead externo nuevo (aún sin corroborar) solo es "visible" si
  // tiene contacto accionable y no es una fuente-señal standalone.
  const qualification = qualifyExternalLead({
    source: candidate.source,
    hasContact: candidateHasContact(candidate),
    corroborated: false,
    foreign: isForeignAddress(candidate.address),
  });

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
        passed_filter: qualification.passed_filter,
        rejection_reasons: qualification.rejection_reasons,
        tags: opts.extraTags ?? [],
        ...(candidate.latitude != null &&
        candidate.longitude != null &&
        isValidCoord(candidate.latitude, candidate.longitude)
          ? { gps: `SRID=4326;POINT(${candidate.longitude} ${candidate.latitude})` }
          : {}),
      },
      { onConflict: "place_id", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`insertExternalLead failed: ${error.message}`);
  const lead = data as Lead;

  if (candidate.email) {
    const existing = (lead.canonical_fields ?? {}) as Record<string, unknown>;
    const { error: emailError } = await db
      .from("leads")
      .update({ canonical_fields: { ...existing, email: candidate.email } })
      .eq("id", lead.id);
    if (emailError) {
      throw new Error(`insertExternalLead email persist failed: ${emailError.message}`);
    }
  }

  return lead;
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

  // GPS backfill: si el lead primario no tenía coordenadas y la fuente corroborante
  // sí las trae, completamos el gps (la mejor señal para futuros cruces).
  // Se chequea contra el lead ya leído (primaryLead), no contra la respuesta del RPC,
  // para no pisar un gps existente si el RPC no devuelve la columna.
  const mergedResult = data as Lead;
  if (
    lead.gps == null &&
    candidate.latitude != null &&
    candidate.longitude != null &&
    isValidCoord(candidate.latitude, candidate.longitude)
  ) {
    const gps = `SRID=4326;POINT(${candidate.longitude} ${candidate.latitude})`;
    const { error: gpsError } = await db.from("leads").update({ gps }).eq("id", leadId);
    if (gpsError) throw new Error(`addCorroboratingSource gps backfill failed: ${gpsError.message}`);
    return { ...mergedResult, gps };
  }

  return mergedResult;
}
