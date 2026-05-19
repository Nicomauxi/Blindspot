import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { DigitalFootprint, DigitalFootprintEnriched, EnrichmentDiff, Lead, LeadUpsert, SocialSearch } from "../shared/types.js";
import { calculateContactReliability } from "../modules/scoring/confidence.js";
import type { BuyerTypeScore, ScoreResult } from "../modules/scoring/types.js";
import { normalizeUruguayMobile } from "../modules/enrichment/parsers/whatsapp.js";
import { MAX_CONTACT_EMAILS } from "../modules/enrichment/index.js";
import {
  appendEnrichmentChange,
  createEnrichmentDiff,
  hasCriticalEnrichmentChange,
} from "../modules/enrichment/change-detection.js";
import { isFranchise, normalizeName } from "../modules/discovery/deduplication.js";
import { classifyUruguayPhone } from "../shared/phone.js";
import { scoreLead } from "../modules/scoring/index.js";
import { computeAllBuyerScores } from "../modules/scoring/buyer-types.js";
import { getAdminServicePricing } from "./service-pricing.js";

export interface UpsertResult {
  inserted: Lead[];
  updated: Lead[];
}
const DUPLICATE_TAG = "possible-duplicate";
const DUPLICATE_SECONDARY_TAG = "duplicate-secondary";
const FRANCHISE_TAG = "franchise-detected";
const SIGNIFICANT_CHANGE_TAG = "state-changed-significant";
const FALLBACK_BLOCKED_EMAIL_DOMAINS = new Set([
  "thinkit.com.uy",
  "smartserv.com.uy",
  "hosting.com.uy",
  "hosteruy.com.uy",
  "uruhost.com.uy",
  "datamedios.com.uy",
  "websitio.com.uy",
  "enaming.com",
]);
const isRejectedTag = (tag: string): boolean => tag.startsWith("rejected:");

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

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

function socialSearchEmails(search: SocialSearch): string[] {
  if (search.source !== "playwright") return [];
  return Array.from(new Set([
    search.facebook?.email ?? null,
    search.instagram?.email ?? null,
  ].filter((email): email is string => email !== null)));
}

function mergeContactEmails(existing: string[] | undefined, search: SocialSearch): string[] | undefined {
  const merged = Array.from(new Set([
    ...(existing ?? []),
    ...socialSearchEmails(search),
  ])).slice(0, MAX_CONTACT_EMAILS);
  return merged.length > 0 ? merged : existing;
}

function normalizeStoredWhatsapp(value: string | null): string | null {
  return value ? normalizeUruguayMobile(value) : null;
}

function normalizeIdentityPhone(value: string | null): string | null {
  const mobile = normalizeStoredWhatsapp(value);
  if (mobile) return mobile;
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("598")) return `+${digits}`;
  if (digits.length === 8 && /^[29]/.test(digits)) return `+598${digits}`;
  if (digits.length === 9 && digits.startsWith("0")) return `+598${digits.slice(1)}`;
  return digits;
}

function normalizeIdentityUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "") || null;
  }
}

function duplicateEmails(
  lead: Lead,
  blockedEmailDomains: ReadonlySet<string> = FALLBACK_BLOCKED_EMAIL_DOMAINS
): string[] {
  const emails = lead.digital_footprint?.contact_emails ?? [];
  return emails
    .map((email) => email.trim().toLowerCase())
    .filter((email) => {
      const domain = email.split("@")[1] ?? "";
      return email.length > 0 && !blockedEmailDomains.has(domain);
    });
}

function duplicateIdentityKeys(
  lead: Lead,
  blockedEmailDomains: ReadonlySet<string> = FALLBACK_BLOCKED_EMAIL_DOMAINS
): string[] {
  const keys: string[] = [];
  const whatsapp = normalizeIdentityPhone(lead.whatsapp);
  if (whatsapp) keys.push(`wa:${whatsapp}`);
  const phone = normalizeIdentityPhone(lead.phone);
  if (phone) keys.push(`phone:${phone}`);
  const web = normalizeIdentityUrl(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
  if (web) keys.push(`web:${web}`);
  for (const email of duplicateEmails(lead, blockedEmailDomains)) {
    keys.push(`email:${email}`);
  }
  return Array.from(new Set(keys));
}

export function detectDuplicates(
  leads: Lead[],
  blockedEmailDomains: ReadonlySet<string> = FALLBACK_BLOCKED_EMAIL_DOMAINS
): Map<string, Lead[]> {
  const parent = new Map<string, string>();
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const keyOwner = new Map<string, string>();

  function find(id: string): string {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const lead of leads) {
    parent.set(lead.id, lead.id);
    for (const key of duplicateIdentityKeys(lead, blockedEmailDomains)) {
      const owner = keyOwner.get(key);
      if (owner) union(owner, lead.id);
      else keyOwner.set(key, lead.id);
    }
  }

  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    const root = find(lead.id);
    const group = groups.get(root) ?? [];
    group.push(lead);
    groups.set(root, group);
  }

  const duplicates = new Map<string, Lead[]>();
  for (const [root, group] of groups) {
    if (group.length <= 1) continue;
    duplicates.set(
      root,
      group.slice().sort((a, b) => {
        const scoreDiff = (b.prospect_score ?? -1) - (a.prospect_score ?? -1);
        if (scoreDiff !== 0) return scoreDiff;
        return a.name.localeCompare(b.name);
      })
    );
  }
  return duplicates;
}

export async function tagDuplicates(leads: Lead[]): Promise<void> {
  const groups = detectDuplicates(leads);
  if (groups.size === 0) return;

  const db = getSupabase();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      const lead = group[i]!;
      const tagSet = new Set(lead.tags);
      tagSet.add(DUPLICATE_TAG);
      if (i > 0) tagSet.add(DUPLICATE_SECONDARY_TAG);
      const tags = Array.from(tagSet);
      const { error } = await db
        .from("leads")
        .update({ tags })
        .eq("id", lead.id);
      if (error) throw new Error(`Failed to tag duplicate lead ${lead.id}: ${error.message}`);
    }
  }
}

export async function tagFranchises(
  leads: Lead[],
  franchiseNames: ReadonlySet<string>
): Promise<void> {
  if (leads.length === 0) return;

  const addressesByName = new Map<string, Set<string>>();
  for (const lead of leads) {
    const norm = normalizeName(lead.name);
    const addrs = addressesByName.get(norm) ?? new Set<string>();
    addrs.add((lead.address ?? "").trim().toLowerCase());
    addressesByName.set(norm, addrs);
  }

  const db = getSupabase();

  for (const lead of leads) {
    if (lead.tags.includes(FRANCHISE_TAG)) continue;

    const byList      = isFranchise(lead.name, franchiseNames);
    const norm        = normalizeName(lead.name);
    const byHeuristic = (addressesByName.get(norm)?.size ?? 0) >= 3;

    if (!byList && !byHeuristic) continue;

    const tags = [...lead.tags, FRANCHISE_TAG];
    const { error } = await db
      .from("leads")
      .update({ tags })
      .eq("id", lead.id);

    if (error) {
      getLogger().warn({ leadId: lead.id, err: error.message }, "tagFranchises — update failed");
    }
  }
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

  const contactEmails = Array.isArray(footprint?.contact_emails)
    ? footprint.contact_emails.filter((email) => email.trim().length > 0)
    : [];
  if (contactEmails.length > 0) {
    set.delete("email-missing");
  } else {
    set.delete("email-found");
  }

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

function withoutLastChangeDiff(footprint: DigitalFootprint): DigitalFootprint {
  if (!("last_change_diff" in footprint)) return footprint;
  const { last_change_diff: _ignored, ...rest } = footprint;
  return rest;
}

function withoutLegacyInferredState(footprint: DigitalFootprint): DigitalFootprint {
  if (!("inferred_state" in footprint)) return footprint;
  const { inferred_state: _ignored, ...rest } = footprint;
  return rest;
}

function sanitizeFootprint(footprint: DigitalFootprint): DigitalFootprint {
  return withoutLegacyInferredState(withoutLastChangeDiff(footprint));
}

function currentContactTier(scoreBreakdown: Record<string, unknown> | null): string | null {
  const value = scoreBreakdown?.["contact_tier"];
  return typeof value === "string" ? value : null;
}

function applyLastChangeDiff(
  footprint: DigitalFootprint,
  diff: EnrichmentDiff | null
): DigitalFootprint {
  const base = sanitizeFootprint(footprint);
  if (diff === null) return base;
  return { ...base, last_change_diff: diff };
}

function canonicalPhoneValue(canonicalFields: Lead["canonical_fields"]): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;

  const directPhone = canonicalFields["phone"];
  if (typeof directPhone === "string") return directPhone;
  if (
    directPhone &&
    typeof directPhone === "object" &&
    "value" in directPhone &&
    typeof directPhone.value === "string"
  ) {
    return directPhone.value;
  }

  return null;
}

function classificationTags(
  leadPhone: string | null,
  canonicalFields: Lead["canonical_fields"],
  footprint: DigitalFootprint
): string[] {
  const tags: string[] = [];
  const phoneTypes = [
    classifyUruguayPhone(leadPhone),
    classifyUruguayPhone(canonicalPhoneValue(canonicalFields)),
    ...(footprint.skipped === true ? [] : (footprint.phone_classification ?? [])),
  ];

  if (phoneTypes.some((phone) => phone.type === "mobile")) tags.push("mobile-phone");
  if (phoneTypes.some((phone) => phone.type === "landline")) tags.push("landline-phone");

  if (
    footprint.skipped !== true &&
    Array.isArray(footprint.email_quality) &&
    footprint.email_quality.length > 0 &&
    footprint.email_quality.every((email) => email.mx_valid === false)
  ) {
    tags.push("email-no-mx");
  }

  return tags;
}

function mergeClassificationTags(
  tags: string[],
  leadPhone: string | null,
  canonicalFields: Lead["canonical_fields"],
  footprint: DigitalFootprint
): string[] {
  const set = new Set(tags);
  set.delete("mobile-phone");
  set.delete("landline-phone");
  set.delete("email-no-mx");

  for (const tag of classificationTags(leadPhone, canonicalFields, footprint)) {
    set.add(tag);
  }

  return Array.from(set);
}

function contactReliabilityLead(
  leadPhone: string | null,
  canonicalFields: Lead["canonical_fields"],
  tags: string[],
  whatsapp: string | null,
  footprint: DigitalFootprint
): Pick<
  Lead,
  "name" | "address" | "rating" | "phone" | "website" | "whatsapp" |
  "tags" | "digital_footprint" | "canonical_fields" |
  "source_confidence" | "corroborating_sources"
> {
  return {
    name: "",
    address: null,
    rating: null,
    phone: leadPhone,
    website: null,
    whatsapp,
    tags,
    digital_footprint: footprint,
    canonical_fields: canonicalFields,
    source_confidence: null,
    corroborating_sources: [],
  };
}

export async function upsertLeads(
  items: LeadUpsert[],
  runId: string,
  profile: string,
  tagsFn: (c: LeadUpsert["candidate"]) => string[]
): Promise<UpsertResult> {
  if (items.length === 0) return { inserted: [], updated: [] };

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
          tags: dedupeTags([...cleanedTags, ...tagsFn(candidate)]),
          passed_filter: true,
          rejection_reasons: [],
        };
      } else if (!passed && existingPassed) {
        // passed → rejected: keep normal tags, add rejected tags
        const cleanedTags = existingTags.filter((t) => !isRejectedTag(t));
        const newRejectedTags = rejection_reasons.map((r) => `rejected:${r}`);
        tagUpdate = {
          tags: dedupeTags([...cleanedTags, ...newRejectedTags]),
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

      if (error) throw new Error(`upsert failed: ${error.message}`);
      if (!data) {
        throw new Error(`Supabase returned no row for placeId=${candidate.placeId}`);
      }
      updated.push(data as Lead);
    } else {
      const tags = dedupeTags(
        passed
          ? tagsFn(candidate)
          : rejection_reasons.map((r) => `rejected:${r}`)
      );

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

      if (error) throw new Error(`upsert failed: ${error.message}`);
      if (!data) {
        throw new Error(`Supabase returned no row for placeId=${candidate.placeId}`);
      }
      inserted.push(data as Lead);
    }
  }

  return { inserted, updated };
}

export async function listLeads(params: {
  runId?: string;
  seenInRunId?: string;
  passedOnly?: boolean;
  rejectedOnly?: boolean;
  limit?: number;
}): Promise<Lead[]> {
  let query = getSupabase().from("leads").select("*").order("name");

  if (params.runId) {
    query = query.eq("first_seen_run_id", params.runId);
  }
  if (params.seenInRunId) {
    query = query.eq("last_seen_run_id", params.seenInRunId);
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

export async function loadLeadsByRunId(
  runId: string,
  opts: { passedOnly?: boolean } = { passedOnly: true }
): Promise<Lead[]> {
  let query = getSupabase()
    .from("leads")
    .select("*")
    .or(`first_seen_run_id.eq.${runId},last_seen_run_id.eq.${runId}`)
    .order("name");
  if (opts.passedOnly) {
    query = query.eq("passed_filter", true);
  }
  const { data, error } = await query;

  if (error) throw new Error(`Failed to load leads for run ${runId}: ${error.message}`);
  return (data ?? []) as Lead[];
}

function isEnriched(fp: DigitalFootprint): fp is DigitalFootprintEnriched {
  return fp.skipped !== true;
}

export function mergeFootprint(
  existing: DigitalFootprint | null,
  fresh: DigitalFootprint
): DigitalFootprint {
  if (existing === null || !isEnriched(existing) || !isEnriched(fresh)) return fresh;

  const prevSocial = existing.social_search ?? null;
  const nextSocial = fresh.social_search ?? null;
  const prevFbOk = prevSocial !== null && socialSearchConfirmsFacebook(prevSocial);
  const prevIgOk = prevSocial !== null && socialSearchConfirmsInstagram(prevSocial);
  const nextFbOk = nextSocial !== null && socialSearchConfirmsFacebook(nextSocial);
  const nextIgOk = nextSocial !== null && socialSearchConfirmsInstagram(nextSocial);

  // Preserve confirming social_search — never downgrade confirmed → non-confirmed.
  const social_search =
    ((prevFbOk && !nextFbOk) || (prevIgOk && !nextIgOk)) && prevSocial !== null
      ? prevSocial
      : nextSocial;

  // Preserve phone_confirmed: true — never downgrade to false/null.
  const phone_confirmed = existing.phone_confirmed === true ? true : fresh.phone_confirmed;

  // Preserve contact_emails — only replace when fresh brings real emails.
  const prevEmails = existing.contact_emails ?? [];
  const nextEmails = fresh.contact_emails ?? [];
  const contact_emails = nextEmails.length > 0 ? nextEmails : prevEmails;
  const email_quality = nextEmails.length > 0
    ? fresh.email_quality
    : existing.email_quality;

  return {
    ...fresh,
    ...(phone_confirmed !== undefined ? { phone_confirmed } : {}),
    contact_emails,
    ...(email_quality !== undefined ? { email_quality } : {}),
    ...(social_search !== null ? { social_search } : {}),
  };
}

export async function updateLeadEnrichment(
  leadId: string,
  footprint: DigitalFootprint,
  newTags: string[],
  whatsappFromSite: string | null,
  inferredState: Lead["inferred_state"] = null
): Promise<{ last_change_diff: EnrichmentDiff | null; critical_change: boolean; rescored: boolean }> {
  const db = getSupabase();
  const nextInferredState =
    inferredState ??
    ((footprint as { inferred_state?: Lead["inferred_state"] | null }).inferred_state ?? null);
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("tags, whatsapp, phone, canonical_fields, digital_footprint, score_breakdown, inferred_state")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);

  const existingFootprint = (current?.digital_footprint as DigitalFootprint | null) ?? null;
  const mergedFootprint = sanitizeFootprint(mergeFootprint(existingFootprint, footprint));
  const previousInferredState = (current?.inferred_state as Lead["inferred_state"]) ?? null;
  const previousContactTier = currentContactTier((current?.score_breakdown as Record<string, unknown> | null) ?? null);
  let changeDiff = createEnrichmentDiff(
    leadId,
    existingFootprint,
    mergedFootprint,
    previousInferredState,
    nextInferredState
  );

  const currentTags: string[] = Array.isArray(current?.tags) ? (current?.tags as string[]) : [];
  const mergedTags = cleanupMergedTagsForEnrichment([...currentTags, ...newTags], mergedFootprint);
  const currentWhatsapp = (current?.whatsapp as string | null) ?? null;
  const mergedWhatsapp = normalizeStoredWhatsapp(currentWhatsapp) ?? normalizeStoredWhatsapp(whatsappFromSite);

  if (mergedWhatsapp &&
      !mergedTags.includes("whatsapp-derived") &&
      !mergedTags.includes("whatsapp-confirmed")) {
    mergedTags.push("whatsapp-derived");
  }
  const currentPhone = (current?.phone as string | null) ?? null;
  const canonicalFields = (current?.canonical_fields as Lead["canonical_fields"]) ?? null;
  const finalTags = dedupeTags(
    mergeClassificationTags(mergedTags, currentPhone, canonicalFields, mergedFootprint)
  ).filter((tag) => tag !== SIGNIFICANT_CHANGE_TAG);
  const contact_reliability_score = calculateContactReliability(
    contactReliabilityLead(
      currentPhone,
      canonicalFields,
      finalTags,
      mergedWhatsapp,
      mergedFootprint
    )
  );

  const updateQuery = db
    .from("leads")
    .update({
      digital_footprint: mergedFootprint,
      inferred_state: nextInferredState,
      contact_reliability_score,
      tags: finalTags,
      whatsapp: mergedWhatsapp,
    })
    .eq("id", leadId);

  const updateResult = await (
    typeof (updateQuery as { select?: unknown }).select === "function"
      ? (updateQuery as unknown as {
          select: (columns: string) => {
            single: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        }).select("*").single()
      : updateQuery
  ) as { data?: unknown; error: { message: string } | null };

  const { error } = updateResult;
  if (error) throw new Error(`Failed to update lead ${leadId}: ${error.message}`);
  if ("data" in updateResult && updateResult.data === null) {
    throw new Error(`Supabase returned no row for leadId=${leadId}`);
  }

  let rescored = false;
  const updatedLeadBase = ("data" in updateResult ? updateResult.data : null) as Lead | null;
  const updatedLead = updatedLeadBase
    ? {
        ...updatedLeadBase,
        inferred_state: updatedLeadBase.inferred_state ?? nextInferredState,
      }
    : null;

  if (updatedLead && changeDiff && hasCriticalEnrichmentChange(changeDiff)) {
    const scoreResult = scoreLead(updatedLead);
    const nextContactTier = currentContactTier(
      scoreResult.score_breakdown as unknown as Record<string, unknown>
    );
    if (previousContactTier !== nextContactTier) {
      changeDiff = appendEnrichmentChange(changeDiff, leadId, {
        field: "contact_tier",
        from: previousContactTier,
        to: nextContactTier,
        significance: "critical",
      });
    }

    await updateLeadScore(leadId, scoreResult);
    const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
    const buyerScores = computeAllBuyerScores(
      {
        ...updatedLead,
        business_quality_score: scoreResult.business_quality_score,
        digital_gap_score: scoreResult.digital_gap_score,
        systems_gap_score: scoreResult.systems_gap_score,
        prospect_score: scoreResult.prospect_score,
        scoring_version: scoreResult.scoring_version,
        contact_ready: scoreResult.contact_ready,
        score_breakdown: scoreResult.score_breakdown as unknown as Record<string, unknown>,
        systems_gap_breakdown: scoreResult.systems_gap_breakdown as unknown as Record<string, unknown>,
      },
      deliverySystemCostUyu != null ? { deliverySystemCostUyu } : {}
    );
    await upsertBuyerScores(leadId, buyerScores);
    rescored = true;
  }

  const criticalChange = hasCriticalEnrichmentChange(changeDiff);
  const finalDiffFootprint = applyLastChangeDiff(mergedFootprint, changeDiff);
  const finalPersistedTags = dedupeTags(
    criticalChange ? [...finalTags, SIGNIFICANT_CHANGE_TAG] : finalTags
  );

  const { error: diffPersistError } = await db
    .from("leads")
    .update({
      digital_footprint: finalDiffFootprint,
      tags: finalPersistedTags,
    })
    .eq("id", leadId);
  if (diffPersistError) {
    throw new Error(`Failed to persist change diff for lead ${leadId}: ${diffPersistError.message}`);
  }

  return {
    last_change_diff: changeDiff,
    critical_change: criticalChange,
    rescored,
  };
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
    .select("digital_footprint, tags, whatsapp, phone, canonical_fields")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);

  const currentFootprint = (current?.digital_footprint as DigitalFootprint | null) ?? null;
  const fetchedAt = socialSearch.ran_at;
  const contactEmails = mergeContactEmails(currentFootprint?.contact_emails, socialSearch);
  const footprint: DigitalFootprint = currentFootprint
    ? {
        ...currentFootprint,
        social_search: socialSearch,
        ...(contactEmails !== undefined ? { contact_emails: contactEmails } : {}),
      }
    : {
        fetched_at: fetchedAt,
        social_search: socialSearch,
        ...(contactEmails !== undefined ? { contact_emails: contactEmails } : {}),
      };
  const currentTags: string[] = Array.isArray(current?.tags) ? (current?.tags as string[]) : [];
  const mergedTags = cleanupMergedTagsForEnrichment([...currentTags, ...newTags], footprint);
  const currentWhatsapp = (current?.whatsapp as string | null) ?? null;
  const mergedWhatsapp = normalizeStoredWhatsapp(currentWhatsapp) ?? normalizeStoredWhatsapp(whatsappFromSocial);

  if (mergedWhatsapp &&
      !mergedTags.includes("whatsapp-derived") &&
      !mergedTags.includes("whatsapp-confirmed")) {
    mergedTags.push("whatsapp-derived");
  }
  const currentPhone = (current?.phone as string | null) ?? null;
  const canonicalFields = (current?.canonical_fields as Lead["canonical_fields"]) ?? null;
  const finalTags = dedupeTags(
    mergeClassificationTags(mergedTags, currentPhone, canonicalFields, footprint)
  );
  const contact_reliability_score = calculateContactReliability(
    contactReliabilityLead(
      currentPhone,
      canonicalFields,
      finalTags,
      mergedWhatsapp,
      footprint
    )
  );

  const { error } = await db
    .from("leads")
    .update({
      digital_footprint: sanitizeFootprint(footprint),
      contact_reliability_score,
      tags: finalTags,
      whatsapp: mergedWhatsapp,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update social search for lead ${leadId}: ${error.message}`);
}

export async function updateLeadSocialEnrichStatus(
  leadId: string,
  status: "ok" | "blocked"
): Promise<void> {
  const db = getSupabase();
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("digital_footprint, tags")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);

  const currentFootprint = (current?.digital_footprint as DigitalFootprint | null) ?? null;
  const footprint: DigitalFootprint = currentFootprint
    ? { ...currentFootprint, social_enrich_status: status }
    : { fetched_at: new Date().toISOString(), social_enrich_status: status };

  const currentTags: string[] = Array.isArray(current?.tags) ? (current?.tags as string[]) : [];
  const newTags = status === "blocked"
    ? [...new Set([...currentTags, "social-blocked"])]
    : currentTags.filter((t) => t !== "social-blocked");

  const { error } = await db
    .from("leads")
    .update({ digital_footprint: sanitizeFootprint(footprint), tags: newTags })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update social_enrich_status for lead ${leadId}: ${error.message}`);
}

export async function patchLeadInferredState(
  leadId: string,
  footprint: DigitalFootprint,
  inferredState: Lead["inferred_state"]
): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from("leads")
    .update({
      digital_footprint: sanitizeFootprint(footprint),
      inferred_state: inferredState,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to patch inferred_state for lead ${leadId}: ${error.message}`);
}

export async function loadAllLeads(): Promise<Lead[]> {
  const db = getSupabase();
  const pageSize = 1000;
  const leads: Lead[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("leads")
      .select("*")
      .order("name")
      .range(from, to);

    if (error) throw new Error(`Failed to load all leads: ${error.message}`);

    const batch = (data ?? []) as Lead[];
    leads.push(...batch);

    if (batch.length < pageSize) break;
  }

  return leads;
}

export async function loadLeadsBySource(
  source: string,
  opts: { passedOnly?: boolean } = { passedOnly: true }
): Promise<Lead[]> {
  const db = getSupabase();
  const pageSize = 1000;
  const leads: Lead[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = db
      .from("leads")
      .select("*")
      .eq("source", source)
      .order("name")
      .range(from, to);
    if (opts.passedOnly) {
      query = query.eq("passed_filter", true);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load leads for source ${source}: ${error.message}`);
    const batch = (data ?? []) as Lead[];
    leads.push(...batch);
    if (batch.length < pageSize) break;
  }

  return leads;
}

export async function loadAllPassedLeads(): Promise<Lead[]> {
  const db = getSupabase();
  const pageSize = 1000;
  const leads: Lead[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("leads")
      .select("*")
      .eq("passed_filter", true)
      .order("name")
      .range(from, to);

    if (error) throw new Error(`Failed to load all passed leads: ${error.message}`);
    const batch = (data ?? []) as Lead[];
    leads.push(...batch);
    if (batch.length < pageSize) break;
  }

  return leads;
}

export async function updateLeadScore(leadId: string, result: ScoreResult): Promise<void> {
  const { error } = await getSupabase()
    .from("leads")
    .update({
      business_quality_score: result.business_quality_score,
      digital_gap_score: result.digital_gap_score,
      systems_gap_score: result.systems_gap_score,
      prospect_score: result.prospect_score,
      scoring_version: result.scoring_version,
      contact_ready: result.contact_ready,
      score_breakdown: result.score_breakdown,
      systems_gap_breakdown: result.systems_gap_breakdown,
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update scores for lead ${leadId}: ${error.message}`);
}

export async function updateLeadCompanyData(
  leadId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const db = getSupabase();
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("lead_company_data")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead_company_data for ${leadId}: ${fetchErr.message}`);
  const merged = { ...(current?.lead_company_data as Record<string, unknown> | null ?? {}), ...patch };
  const { error } = await db.from("leads").update({ lead_company_data: merged }).eq("id", leadId);
  if (error) throw new Error(`Failed to update lead_company_data for ${leadId}: ${error.message}`);
}

export async function upsertBuyerScores(
  leadId: string,
  scores: BuyerTypeScore[]
): Promise<void> {
  if (scores.length === 0) return;
  const db = getSupabase();
  const rows = scores.map((s) => ({
    lead_id: leadId,
    buyer_type: s.buyer_type,
    score: s.score,
    breakdown: s.breakdown,
    scoring_version: 2,
    computed_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("lead_buyer_scores")
    .upsert(rows, { onConflict: "lead_id,buyer_type" });
  if (error) throw new Error(`upsertBuyerScores failed: ${error.message}`);
}
