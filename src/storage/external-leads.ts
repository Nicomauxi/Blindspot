import { getSupabase } from "../shared/supabase.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../shared/types.js";
import { calculateContactReliability, calculateDataConfidence } from "../modules/scoring/confidence.js";
import { isValidCoord } from "../modules/discovery/geo-text.js";
import { isForeignAddress } from "../modules/discovery/geo-validator.js";
import { candidateHasContact, leadHasContact, qualifyExternalLead } from "../modules/discovery/qualification.js";
import { classifyVertical, verticalTag } from "../modules/discovery/vertical.js";
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

  // Vertical de negocio (solo DEI trae CIIU): segmenta industrial/otro fuera del pool
  // comercial y se taguea para el scoring/tier. F1.4.
  const vertical =
    candidate.source === "miem_dei"
      ? classifyVertical(String(candidate.raw["Codigo CIIU principal"] ?? ""))
      : undefined;

  // Gate de calidad: un lead externo nuevo (aún sin corroborar) solo es "visible" si
  // tiene contacto accionable y no es una fuente-señal standalone.
  const qualification = qualifyExternalLead({
    source: candidate.source,
    hasContact: candidateHasContact(candidate),
    corroborated: false,
    foreign: isForeignAddress(candidate.address),
    ...(vertical ? { vertical } : {}),
  });

  const tags = [...(opts.extraTags ?? []), ...(vertical ? [verticalTag(vertical)] : [])];

  // N16: el dedup intra-fuente excluye leads de la misma fuente del match, así que en
  // re-runs TODO candidato re-fetcheado cae acá sobre su propia fila. El upsert ciego
  // pisaba tags/state/passed_filter/niche de leads ya deduplicados/enriquecidos.
  const { data: existingRow, error: existingError } = await db
    .from("leads")
    .select("*")
    .eq("place_id", placeId)
    .maybeSingle();
  if (existingError) throw new Error(`insertExternalLead lookup failed: ${existingError.message}`);

  if (existingRow) {
    return updateExistingExternalLead(existingRow as Lead, candidate, vertical);
  }

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
        tags,
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
    // N33: shape contractual {value, confidence, sources, conflict} — el string plano
    // dejaba el email invisible para lead_dashboard/KPIs (->>'value' devuelve NULL).
    const { error: emailError } = await db
      .from("leads")
      .update({
        canonical_fields: {
          ...existing,
          email: {
            value: candidate.email,
            confidence: candidate.source_confidence,
            sources: [candidate.source],
            conflict: false,
          },
        },
      })
      .eq("id", lead.id);
    if (emailError) {
      throw new Error(`insertExternalLead email persist failed: ${emailError.message}`);
    }
  }

  return lead;
}

// Razones de higiene que NUNCA se rescatan automáticamente (las puso un proceso de
// dedup/limpieza, no la calificación de contacto).
const NON_RESCUABLE_REASONS = new Set(["duplicate-secondary", "placeholder-name"]);

// N16: re-descubrimiento de la misma fuente → refrescar SOLO los datos crudos del
// provider (source_data, name, address, phone, website, gps faltante), preservando
// tags/state/niche/dedup. N17: única excepción — rescue one-way de passed_filter
// false→true si el lead ahora corrobora/tiene contacto y su rechazo era rescatable.
async function updateExistingExternalLead(
  existing: Lead,
  candidate: DiscoveryCandidate,
  vertical: ReturnType<typeof classifyVertical> | undefined
): Promise<Lead> {
  const db = getSupabase();

  const corroborated = (existing.corroborating_sources ?? []).length > 0;
  const qualification = qualifyExternalLead({
    source: candidate.source,
    hasContact: candidateHasContact(candidate) || leadHasContact(existing),
    corroborated,
    foreign: isForeignAddress(candidate.address ?? existing.address),
    ...(vertical ? { vertical } : {}),
  });

  const reasons = existing.rejection_reasons ?? [];
  const canRescue =
    existing.passed_filter === false &&
    qualification.passed_filter &&
    !reasons.some((reason) => NON_RESCUABLE_REASONS.has(reason));

  const payload: Record<string, unknown> = {
    source_data: candidate.raw,
    name: candidate.name,
    address: candidate.address ?? existing.address,
    phone: candidate.phone ?? existing.phone,
    website: candidate.website ?? existing.website,
    ...(existing.gps == null &&
    candidate.latitude != null &&
    candidate.longitude != null &&
    isValidCoord(candidate.latitude, candidate.longitude)
      ? { gps: `SRID=4326;POINT(${candidate.longitude} ${candidate.latitude})` }
      : {}),
    ...(canRescue ? { passed_filter: true, rejection_reasons: [] } : {}),
  };

  const { data, error } = await db
    .from("leads")
    .update(payload)
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw new Error(`insertExternalLead refresh failed: ${error.message}`);
  return data as Lead;
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
  let mergedResult = data as Lead;

  // N17: passed_filter era write-once — un rejected 'no-contact' que ahora ESTÁ
  // corroborado y tiene contacto mergeado en canonical_fields quedaba fuera del pool
  // para siempre (caso real: 'Soho' con email+phone+web de 2 fuentes). Rescue one-way:
  // nunca degrada, y nunca toca rechazos de higiene (duplicate-secondary, etc.).
  const rescueReasons = lead.rejection_reasons ?? [];
  if (
    lead.passed_filter === false &&
    !rescueReasons.some((reason) => NON_RESCUABLE_REASONS.has(reason)) &&
    qualifyExternalLead({
      source: candidate.source,
      hasContact: leadHasContact({ ...mergedLead, ...mergedResult }) || candidateHasContact(candidate),
      corroborated: true,
      foreign: isForeignAddress(lead.address ?? candidate.address),
    }).passed_filter
  ) {
    const { error: rescueError } = await db
      .from("leads")
      .update({ passed_filter: true, rejection_reasons: [] })
      .eq("id", leadId);
    if (rescueError) throw new Error(`addCorroboratingSource rescue failed: ${rescueError.message}`);
    mergedResult = { ...mergedResult, passed_filter: true, rejection_reasons: [] };
  }

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
