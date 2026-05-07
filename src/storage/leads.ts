import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { Lead, PlaceCandidate } from "../shared/types.js";

export interface UpsertResult {
  inserted: Lead[];
  updated: Lead[];
}

export async function upsertLeads(
  candidates: PlaceCandidate[],
  runId: string,
  profile: string,
  tagsFn: (c: PlaceCandidate) => string[]
): Promise<UpsertResult> {
  if (candidates.length === 0) return { inserted: [], updated: [] };

  const log = getLogger();
  const db = getSupabase();

  // Fetch existing leads for deduplication
  const placeIds = candidates.map((c) => c.placeId);
  const { data: existing, error: fetchError } = await db
    .from("leads")
    .select("id, place_id, tags, score, notes, state")
    .in("place_id", placeIds);

  if (fetchError) throw new Error(`Failed to fetch existing leads: ${fetchError.message}`);

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.place_id as string, r])
  );

  const inserted: Lead[] = [];
  const updated: Lead[] = [];

  for (const candidate of candidates) {
    const alreadyExists = existingMap.get(candidate.placeId);

    if (alreadyExists) {
      // Update Google-sourced fields only.
      // Preserved (user-managed): first_seen_run_id, tags, state, notes, score, score_breakdown.
      const { data, error } = await db
        .from("leads")
        .update({
          name: candidate.name,
          formatted_address: candidate.formattedAddress,
          rating: candidate.rating,
          user_rating_count: candidate.userRatingCount,
          website_uri: candidate.websiteUri,
          phone: candidate.phone,
          business_status: candidate.businessStatus,
          raw_place_data: candidate.raw,
          last_seen_run_id: runId,
          // updated_at handled by DB trigger
        })
        .eq("place_id", candidate.placeId)
        .select()
        .single();

      if (error) {
        log.error({ placeId: candidate.placeId, error }, "Failed to update lead");
      } else if (data) {
        updated.push(data as Lead);
      }
    } else {
      const tags = tagsFn(candidate);

      const { data, error } = await db
        .from("leads")
        .insert({
          place_id: candidate.placeId,
          name: candidate.name,
          formatted_address: candidate.formattedAddress,
          rating: candidate.rating,
          user_rating_count: candidate.userRatingCount,
          website_uri: candidate.websiteUri,
          phone: candidate.phone,
          business_status: candidate.businessStatus,
          state: "discovered",
          tags,
          first_seen_run_id: runId,
          last_seen_run_id: runId,
          discovery_profile: profile,
          raw_place_data: candidate.raw,
        })
        .select()
        .single();

      if (error) {
        log.error({ placeId: candidate.placeId, error }, "Failed to insert lead");
      } else if (data) {
        inserted.push(data as Lead);
      }
    }
  }

  return { inserted, updated };
}
