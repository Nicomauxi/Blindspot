import { getSupabase } from "../shared/supabase.js";
import type { CorroboratingSource, DiscoveryCandidate, Lead } from "../shared/types.js";

interface DryRunOpts {
  dryRun?: boolean;
}

export async function insertExternalLead(
  candidate: DiscoveryCandidate,
  opts: DryRunOpts = {}
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
        tags: [],
      },
      { onConflict: "place_id", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`insertExternalLead failed: ${error.message}`);
  return data as Lead;
}

export async function addCorroboratingSource(
  leadId: string,
  candidate: DiscoveryCandidate,
  opts: DryRunOpts = {}
): Promise<void> {
  if (opts.dryRun) return;

  const db = getSupabase();
  const seenAt = new Date().toISOString();

  const { error: refError } = await db.from("lead_source_references").upsert(
    {
      lead_id: leadId,
      source: candidate.source,
      external_id: candidate.external_id,
      source_confidence: candidate.source_confidence,
      raw_data: candidate.raw,
      seen_at: seenAt,
    },
    { onConflict: "lead_id,source" }
  );

  if (refError) throw new Error(`addCorroboratingSource ref insert failed: ${refError.message}`);

  const { data: leadRow, error: fetchError } = await db
    .from("leads")
    .select("corroborating_sources")
    .eq("id", leadId)
    .single();

  if (fetchError) throw new Error(`addCorroboratingSource lead fetch failed: ${fetchError.message}`);

  const existing: CorroboratingSource[] = (leadRow as { corroborating_sources: CorroboratingSource[] }).corroborating_sources ?? [];
  if (existing.some((s) => s.source === candidate.source)) return;

  const newSource: CorroboratingSource = {
    source: candidate.source,
    external_id: candidate.external_id,
    seen_at: seenAt,
    confidence: candidate.source_confidence,
  };

  const { error: updateError } = await db
    .from("leads")
    .update({ corroborating_sources: [...existing, newSource] })
    .eq("id", leadId);

  if (updateError) throw new Error(`addCorroboratingSource update failed: ${updateError.message}`);
}
