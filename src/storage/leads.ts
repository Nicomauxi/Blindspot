import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { PlaceCandidate } from "../shared/types.js";

export interface UpsertResult {
  created: number;
  updated: number;
}

export async function upsertLeads(
  candidates: PlaceCandidate[],
  runId: string,
  profile: string,
  tagsFn: (c: PlaceCandidate) => string[]
): Promise<UpsertResult> {
  if (candidates.length === 0) return { created: 0, updated: 0 };

  const log = getLogger();
  const db = getSupabase();

  // Fetch existing leads for deduplication
  const placeIds = candidates.map((c) => c.placeId);
  const { data: existing, error: fetchError } = await db
    .from("leads")
    .select("id, place_id, tags, score, notes")
    .in("place_id", placeIds);

  if (fetchError) throw new Error(`Failed to fetch existing leads: ${fetchError.message}`);

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.place_id as string, r])
  );

  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.placeId);

    if (existing) {
      // Update metadata but preserve score, tags, notes
      const { error } = await db
        .from("leads")
        .update({
          name: candidate.name,
          formatted_address: candidate.formattedAddress,
          rating: candidate.rating,
          user_rating_count: candidate.userRatingCount,
          website_uri: candidate.websiteUri,
          phone: candidate.phone,
          business_status: candidate.businessStatus,
          last_seen_run_id: runId,
          raw_place_data: candidate.raw,
          // DO NOT overwrite: score, tags, notes, state
        })
        .eq("place_id", candidate.placeId);

      if (error) {
        log.error({ placeId: candidate.placeId, error }, "Failed to update lead");
      } else {
        updated++;
      }
    } else {
      const tags = tagsFn(candidate);

      const { error } = await db.from("leads").insert({
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
      });

      if (error) {
        log.error({ placeId: candidate.placeId, error }, "Failed to insert lead");
      } else {
        created++;
      }
    }
  }

  return { created, updated };
}
