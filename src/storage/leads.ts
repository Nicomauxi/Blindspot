import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { DigitalFootprint, Lead, LeadUpsert, SocialSearch } from "../shared/types.js";
import type { ScoreResult } from "../modules/scoring/types.js";

export interface UpsertResult {
  inserted: Lead[];
  updated: Lead[];
}

const isRejectedTag = (tag: string): boolean => tag.startsWith("rejected:");

function socialSearchConfirmsFacebook(search: SocialSearch): boolean {
  if (search.source === "duckduckgo") {
    return search.facebook.best_url !== null;
  }
  return search.facebook !== null && search.facebook.confidence >= 0.7;
}

function socialSearchConfirmsInstagram(search: SocialSearch): boolean {
  if (search.source === "duckduckgo") {
    return search.instagram.best_url !== null;
  }
  return search.instagram !== null && search.instagram.confidence >= 0.7;
}

function socialSearchHasAdditionalPhones(search: SocialSearch): boolean {
  if (search.source === "duckduckgo") {
    return (
      search.facebook.additional_phones.length > 0 ||
      search.instagram.additional_phones.length > 0
    );
  }
  return false;
}

function socialSearchConfirmsWhatsapp(search: SocialSearch): boolean {
  return search.source === "playwright" &&
    search.facebook !== null &&
    search.facebook.confidence >= 0.7 &&
    search.facebook.whatsapp_button;
}

export function cleanupMergedTagsForEnrichment(
  tags: string[],
  footprint?: DigitalFootprint
): string[] {
  const set = new Set(tags);
  if (set.has("website-heuristic")) set.delete("no-website");
  if (set.has("fb-heuristic")) set.delete("fb-only-presence");
  if (set.has("ig-heuristic")) set.delete("ig-only-presence");
  if (set.has("fb-confirmed")) set.delete("fb-heuristic");
  if (set.has("ig-confirmed")) set.delete("ig-heuristic");
  if (set.has("whatsapp-derived")) set.delete("whatsapp-missing");
  if (set.has("whatsapp-confirmed")) set.delete("whatsapp-missing");
  const heuristic = footprint?.heuristic_discovery;
  if (heuristic) {
    if (heuristic.selected.website === null) set.delete("website-heuristic");
    if (heuristic.selected.facebook === null) set.delete("fb-heuristic");
    if (heuristic.selected.instagram === null) set.delete("ig-heuristic");
    if (heuristic.selected.whatsapp === null) set.delete("whatsapp-derived");
    if (!heuristic.stale) set.delete("heuristic-stale");
  }
  const socialSearch = footprint?.social_search;
  if (socialSearch) {
    if (!socialSearchConfirmsFacebook(socialSearch)) set.delete("fb-confirmed");
    if (!socialSearchConfirmsInstagram(socialSearch)) set.delete("ig-confirmed");
    if (!socialSearchHasAdditionalPhones(socialSearch)) set.delete("additional-phones");
    if (!socialSearchConfirmsWhatsapp(socialSearch)) set.delete("whatsapp-confirmed");
  }
  return Array.from(set);
}

export async function upsertLeads(
  items: LeadUpsert[],
  runId: string,
  profile: string,
  tagsFn: (c: LeadUpsert["candidate"]) => string[]
): Promise<UpsertResult> {
  if (items.length === 0) return { inserted: [], updated: [] };

  const log = getLogger();
  const db = getSupabase();

  const placeIds = items.map((i) => i.candidate.placeId);
  const { data: existing, error: fetchError } = await db
    .from("leads")
    .select("id, place_id, tags, notes, state, passed_filter, rejection_reasons")
    .in("place_id", placeIds);

  if (fetchError) throw new Error(`Failed to fetch existing leads: ${fetchError.message}`);

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.place_id as string, r])
  );

  const inserted: Lead[] = [];
  const updated: Lead[] = [];

  for (const item of items) {
    const { candidate, passed, rejection_reasons } = item;
    const alreadyExists = existingMap.get(candidate.placeId);

    if (alreadyExists) {
      const existingTags: string[] = Array.isArray(alreadyExists.tags)
        ? (alreadyExists.tags as string[])
        : [];
      const existingPassed = alreadyExists.passed_filter as boolean;

      const baseUpdate = {
        name: candidate.name,
        address: candidate.formattedAddress,
        rating: candidate.rating,
        review_count: candidate.userRatingCount,
        website: candidate.websiteUri,
        phone: candidate.phone,
        business_status: candidate.businessStatus,
        google_data: candidate.raw,
        last_seen_run_id: runId,
        ...(item.niche !== undefined ? { niche: item.niche } : {}),
      };

      let tagUpdate: { tags?: string[]; passed_filter?: boolean; rejection_reasons?: string[] } = {};

      if (passed && !existingPassed) {
        // rejected → passed: clean rejected tags, add normal tags
        const cleanedTags = existingTags.filter((t) => !isRejectedTag(t));
        tagUpdate = {
          tags: [...cleanedTags, ...tagsFn(candidate)],
          passed_filter: true,
          rejection_reasons: [],
        };
      } else if (!passed && existingPassed) {
        // passed → rejected: keep normal tags, add rejected tags
        const cleanedTags = existingTags.filter((t) => !isRejectedTag(t));
        const newRejectedTags = rejection_reasons.map((r) => `rejected:${r}`);
        tagUpdate = {
          tags: [...cleanedTags, ...newRejectedTags],
          passed_filter: false,
          rejection_reasons,
        };
      }

      const { data, error } = await db
        .from("leads")
        .update({ ...baseUpdate, ...tagUpdate })
        .eq("place_id", candidate.placeId)
        .select()
        .single();

      if (error) {
        log.error({ placeId: candidate.placeId, error }, "Failed to update lead");
      } else if (data) {
        updated.push(data as Lead);
      }
    } else {
      const tags = passed
        ? tagsFn(candidate)
        : rejection_reasons.map((r) => `rejected:${r}`);

      const { data, error } = await db
        .from("leads")
        .insert({
          place_id: candidate.placeId,
          name: candidate.name,
          address: candidate.formattedAddress,
          rating: candidate.rating,
          review_count: candidate.userRatingCount,
          website: candidate.websiteUri,
          phone: candidate.phone,
          business_status: candidate.businessStatus,
          niche: item.niche ?? null,
          state: "discovered",
          tags,
          passed_filter: passed,
          rejection_reasons,
          first_seen_run_id: runId,
          last_seen_run_id: runId,
          google_data: candidate.raw,
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

export async function listLeads(params: {
  runId?: string;
  passedOnly?: boolean;
  rejectedOnly?: boolean;
  limit?: number;
}): Promise<Lead[]> {
  let query = getSupabase().from("leads").select("*").order("name");

  if (params.runId) {
    query = query.or(
      `first_seen_run_id.eq.${params.runId},last_seen_run_id.eq.${params.runId}`
    );
  }

  if (params.passedOnly) {
    query = query.eq("passed_filter", true);
  } else if (params.rejectedOnly) {
    query = query.eq("passed_filter", false);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list leads: ${error.message}`);
  return (data ?? []) as Lead[];
}

export async function loadLeadsByRunId(runId: string): Promise<Lead[]> {
  const { data, error } = await getSupabase()
    .from("leads")
    .select("*")
    .or(`first_seen_run_id.eq.${runId},last_seen_run_id.eq.${runId}`)
    .order("name");

  if (error) throw new Error(`Failed to load leads for run ${runId}: ${error.message}`);
  return (data ?? []) as Lead[];
}

export async function updateLeadEnrichment(
  leadId: string,
  footprint: DigitalFootprint,
  newTags: string[],
  whatsappFromSite: string | null
): Promise<void> {
  const db = getSupabase();
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("tags, whatsapp")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);

  const currentTags: string[] = Array.isArray(current?.tags) ? (current?.tags as string[]) : [];
  const mergedTags = cleanupMergedTagsForEnrichment([...currentTags, ...newTags], footprint);
  const currentWhatsapp = (current?.whatsapp as string | null) ?? null;
  const mergedWhatsapp = currentWhatsapp ?? whatsappFromSite ?? null;

  const { error } = await db
    .from("leads")
    .update({
      digital_footprint: footprint,
      tags: mergedTags,
      whatsapp: mergedWhatsapp,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update lead ${leadId}: ${error.message}`);
}

export async function updateLeadSocialSearch(
  leadId: string,
  socialSearch: SocialSearch,
  newTags: string[],
  whatsappFromSocial: string | null
): Promise<void> {
  const db = getSupabase();
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("digital_footprint, tags, whatsapp")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);

  const currentFootprint = (current?.digital_footprint as DigitalFootprint | null) ?? null;
  const fetchedAt = socialSearch.ran_at;
  const footprint: DigitalFootprint = currentFootprint
    ? { ...currentFootprint, social_search: socialSearch }
    : { fetched_at: fetchedAt, social_search: socialSearch };
  const currentTags: string[] = Array.isArray(current?.tags) ? (current?.tags as string[]) : [];
  const mergedTags = cleanupMergedTagsForEnrichment([...currentTags, ...newTags], footprint);
  const currentWhatsapp = (current?.whatsapp as string | null) ?? null;
  const mergedWhatsapp = currentWhatsapp ?? whatsappFromSocial ?? null;

  const { error } = await db
    .from("leads")
    .update({
      digital_footprint: footprint,
      tags: mergedTags,
      whatsapp: mergedWhatsapp,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update social search for lead ${leadId}: ${error.message}`);
}

export async function loadAllLeads(): Promise<Lead[]> {
  const { data, error } = await getSupabase()
    .from("leads")
    .select("*")
    .order("name");
  if (error) throw new Error(`Failed to load all leads: ${error.message}`);
  return (data ?? []) as Lead[];
}

export async function updateLeadScore(leadId: string, result: ScoreResult): Promise<void> {
  const { error } = await getSupabase()
    .from("leads")
    .update({
      business_quality_score: result.business_quality_score,
      digital_gap_score: result.digital_gap_score,
      systems_gap_score: result.systems_gap_score,
      prospect_score: result.prospect_score,
      score_breakdown: result.score_breakdown,
      systems_gap_breakdown: result.systems_gap_breakdown,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update scores for lead ${leadId}: ${error.message}`);
}
