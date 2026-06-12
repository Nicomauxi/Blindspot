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
const TAG_UPDATE_BATCH_SIZE = 25;
const TAG_UPDATE_MAX_RETRIES = 3;
const TAG_UPDATE_RETRY_BASE_MS = 150;
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface LeadTagUpdate {
  id: string;
  tags: string[];
  /** F5.1: los duplicate-secondary se fuerzan fuera del pool. */
  passed_filter?: boolean;
  rejection_reasons?: string[];
}

async function updateLeadTagsWithRetry(
  id: string,
  tags: string[],
  label: string,
  extra: { passed_filter?: boolean | undefined; rejection_reasons?: string[] | undefined } = {}
): Promise<{ id: string; error: Error | null }> {
  const db = getSupabase();
  const payload: Record<string, unknown> = { tags };
  if (extra.passed_filter !== undefined) payload.passed_filter = extra.passed_filter;
  if (extra.rejection_reasons !== undefined) payload.rejection_reasons = extra.rejection_reasons;

  for (let attempt = 1; attempt <= TAG_UPDATE_MAX_RETRIES; attempt++) {
    try {
      const { error } = await db.from("leads").update(payload).eq("id", id);
      if (!error) return { id, error: null };

      const message = error.message ?? `${label} update failed`;
      if (attempt === TAG_UPDATE_MAX_RETRIES) {
        return { id, error: new Error(message) };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === TAG_UPDATE_MAX_RETRIES) {
        return { id, error: new Error(message) };
      }
    }

    await sleep(TAG_UPDATE_RETRY_BASE_MS * attempt);
  }

  return { id, error: new Error(`${label} update failed`) };
}

async function runLeadTagUpdates(
  updates: LeadTagUpdate[],
  label: string
): Promise<void> {
  const failures: Array<{ id: string; error: Error }> = [];

  for (let offset = 0; offset < updates.length; offset += TAG_UPDATE_BATCH_SIZE) {
    const batch = updates.slice(offset, offset + TAG_UPDATE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(({ id, tags, passed_filter, rejection_reasons }) =>
        updateLeadTagsWithRetry(id, tags, label, { passed_filter, rejection_reasons })
      )
    );

    for (const result of results) {
      if (result.error) failures.push({ id: result.id, error: result.error });
    }
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.id}: ${f.error.message}`).join("; ");
    throw new Error(`${label} failed for ${failures.length} lead(s): ${summary}`);
  }
}

// F5.1: el secundario de un grupo de duplicados no es un negocio distinto — queda
// fuera del pool (passed_filter=false) con la razón explícita, además del tag.
export function buildDuplicateTagUpdates(groups: Map<string, Lead[]>): LeadTagUpdate[] {
  const updates: LeadTagUpdate[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      const lead = group[i]!;
      const tagSet = new Set(lead.tags);
      tagSet.add(DUPLICATE_TAG);
      if (i === 0) {
        updates.push({ id: lead.id, tags: Array.from(tagSet) });
        continue;
      }
      tagSet.add(DUPLICATE_SECONDARY_TAG);
      const reasons = new Set(lead.rejection_reasons);
      reasons.add(DUPLICATE_SECONDARY_TAG);
      updates.push({
        id: lead.id,
        tags: Array.from(tagSet),
        passed_filter: false,
        rejection_reasons: Array.from(reasons),
      });
    }
  }
  return updates;
}

export async function tagDuplicates(leads: Lead[]): Promise<void> {
  const groups = detectDuplicates(leads);
  if (groups.size === 0) return;

  // Build update plans first, then execute in bounded batches with retries.
  // The full scoring flow can touch thousands of rows; unbounded Promise.all()
  // against PostgREST causes transient fetch failures under load.
  await runLeadTagUpdates(buildDuplicateTagUpdates(groups), "tagDuplicates");
}

export async function tagFranchises(
  leads: Lead[],
  franchiseNames: ReadonlySet<string>
): Promise<void> {
  if (leads.length === 0) return;

  // F2.7: SOLO la lista curada franchise_names marca franquicia. La vieja heurística
  // "mismo nombre en ≥3 direcciones" producía falsos positivos (mutualistas, agencias,
  // nombres comunes de PYME) que les ponían penalización de scoring y bloqueaban su
  // fusión. La detección de sucursales para el merge-guard vive aparte (franchiseSafeToMerge,
  // por puerta/GPS), no acá.
  const failures: Array<{ leadId: string; message: string }> = [];

  for (const lead of leads) {
    if (lead.tags.includes(FRANCHISE_TAG)) continue;
    if (!isFranchise(lead.name, franchiseNames)) continue;

    const tags = [...lead.tags, FRANCHISE_TAG];
    const result = await updateLeadTagsWithRetry(lead.id, tags, "tagFranchises");

    if (result.error) {
      failures.push({ leadId: lead.id, message: result.error.message });
    }
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.leadId}: ${f.message}`).join("; ");
    throw new Error(`tagFranchises failed for ${failures.length} lead(s): ${summary}`);
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

  // Partition items into pure inserts (no existing row) and updates (need
  // flip-logic merge). Inserts go through ONE batched `.insert().select()` so
  // we avoid an N+1 round-trip. Updates stay sequential because each one
  // carries lead-specific tag-merge logic that cannot be expressed as a
  // batched upsert without overwriting fields the caller never read.
  const toInsertRows: Array<Record<string, unknown>> = [];
  const insertPlaceIds: string[] = [];
  const toUpdate: LeadUpsert[] = [];

  for (const item of items) {
    if (existingMap.has(item.candidate.placeId)) {
      toUpdate.push(item);
    } else {
      const { candidate, passed, rejection_reasons } = item;
      const tags = dedupeTags(
        passed
          ? tagsFn(candidate)
          : rejection_reasons.map((r) => `rejected:${r}`)
      );
      toInsertRows.push({
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
        gps:
          candidate.lat != null && candidate.lng != null
            ? `SRID=4326;POINT(${candidate.lng} ${candidate.lat})`
            : null,
      });
      insertPlaceIds.push(candidate.placeId);
    }
  }

  const inserted: Lead[] = [];
  if (toInsertRows.length > 0) {
    const { data: insertData, error: insertError } = await db
      .from("leads")
      .insert(toInsertRows)
      .select();
    if (insertError) throw new Error(`upsert failed: ${insertError.message}`);
    const rows = (insertData ?? []) as Lead[];
    if (rows.length !== toInsertRows.length) {
      throw new Error(
        `Supabase returned no row for placeId=${insertPlaceIds[0] ?? "unknown"}`
      );
    }
    inserted.push(...rows);
  }

  const updated: Lead[] = [];
  for (const item of toUpdate) {
    const { candidate, passed, rejection_reasons } = item;
    const alreadyExists = existingMap.get(candidate.placeId)!;
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
      ...(candidate.lat != null && candidate.lng != null
        ? { gps: `SRID=4326;POINT(${candidate.lng} ${candidate.lat})` }
        : {}),
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

  const limit = params.limit ?? 2000;
  const { data, error } = await query.limit(limit);
  if (error) throw new Error(`Failed to list leads: ${error.message}`);
  const rows = (data ?? []) as Lead[];
  if (rows.length === limit) {
    getLogger().warn(
      { count: rows.length, limit },
      "listLeads hit limit — results may be truncated"
    );
  }
  return rows;
}

export async function loadLeadsByRunId(
  runId: string,
  opts: { passedOnly?: boolean; limit?: number } = { passedOnly: true }
): Promise<Lead[]> {
  let query = getSupabase()
    .from("leads")
    .select("*")
    .or(`first_seen_run_id.eq.${runId},last_seen_run_id.eq.${runId}`)
    .order("name");
  if (opts.passedOnly) {
    query = query.eq("passed_filter", true);
  }
  const limit = opts.limit ?? 2000;
  const { data, error } = await query.limit(limit);

  if (error) throw new Error(`Failed to load leads for run ${runId}: ${error.message}`);
  const rows = (data ?? []) as Lead[];
  if (rows.length === limit) {
    getLogger().warn(
      { runId, count: rows.length, limit },
      "loadLeadsByRunId hit limit — results may be truncated"
    );
  }
  return rows;
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
  // Load all columns needed for in-memory rescore so we can consolidate writes
  // into a single UPDATE on `leads` instead of three sequential round-trips.
  const { data: current, error: fetchErr } = await db
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (fetchErr) throw new Error(`Failed to load lead ${leadId}: ${fetchErr.message}`);
  if (!current) throw new Error(`Supabase returned no row for leadId=${leadId}`);

  const currentLead = current as Lead;
  const existingFootprint = currentLead.digital_footprint ?? null;
  const mergedFootprint = sanitizeFootprint(mergeFootprint(existingFootprint, footprint));
  const previousInferredState = currentLead.inferred_state ?? null;
  const previousContactTier = currentContactTier(currentLead.score_breakdown ?? null);
  let changeDiff = createEnrichmentDiff(
    leadId,
    existingFootprint,
    mergedFootprint,
    previousInferredState,
    nextInferredState
  );

  const currentTags: string[] = Array.isArray(currentLead.tags) ? currentLead.tags : [];
  const mergedTags = cleanupMergedTagsForEnrichment([...currentTags, ...newTags], mergedFootprint);
  const currentWhatsapp = currentLead.whatsapp ?? null;
  const mergedWhatsapp = normalizeStoredWhatsapp(currentWhatsapp) ?? normalizeStoredWhatsapp(whatsappFromSite);

  if (mergedWhatsapp &&
      !mergedTags.includes("whatsapp-derived") &&
      !mergedTags.includes("whatsapp-confirmed")) {
    mergedTags.push("whatsapp-derived");
  }
  const currentPhone = currentLead.phone ?? null;
  const canonicalFields = currentLead.canonical_fields ?? null;
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

  // Build a simulated lead reflecting all in-memory mutations. This lets us
  // run the rescore BEFORE writing, so we can fold last_change_diff (incl. the
  // contact_tier delta) and the SIGNIFICANT tag into a single UPDATE.
  const simulatedLead: Lead = {
    ...currentLead,
    digital_footprint: mergedFootprint,
    inferred_state: nextInferredState,
    contact_reliability_score,
    tags: finalTags,
    whatsapp: mergedWhatsapp,
    phone: currentPhone,
    canonical_fields: canonicalFields,
  };

  let rescoreResult: ScoreResult | null = null;
  let rescoreBuyerScores: BuyerTypeScore[] | null = null;

  if (changeDiff && hasCriticalEnrichmentChange(changeDiff)) {
    const scoreResult = scoreLead(simulatedLead);
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

    const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
    rescoreBuyerScores = computeAllBuyerScores(
      {
        ...simulatedLead,
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
    rescoreResult = scoreResult;
  }

  const criticalChange = hasCriticalEnrichmentChange(changeDiff);
  const finalDiffFootprint = applyLastChangeDiff(mergedFootprint, changeDiff);
  const finalPersistedTags = dedupeTags(
    criticalChange ? [...finalTags, SIGNIFICANT_CHANGE_TAG] : finalTags
  );

  const { error: updateError } = await db
    .from("leads")
    .update({
      digital_footprint: finalDiffFootprint,
      inferred_state: nextInferredState,
      contact_reliability_score,
      tags: finalPersistedTags,
      whatsapp: mergedWhatsapp,
    })
    .eq("id", leadId);
  if (updateError) {
    throw new Error(`Failed to update lead ${leadId}: ${updateError.message}`);
  }

  // Score persistence and buyer scores live in separate tables/columns; doing
  // them after the consolidated UPDATE keeps `leads` writes single-shot.
  // Partial-failure risk between leads-update and lead_scores/buyer_scores
  // is logged as known debt — it cannot corrupt the leads row itself.
  let rescored = false;
  if (rescoreResult && rescoreBuyerScores) {
    await updateLeadScore(leadId, rescoreResult);
    await upsertBuyerScores(leadId, rescoreBuyerScores);
    rescored = true;
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
  whatsappFromSocial: string | null,
  socialActivity?: import("../modules/social-enrich/social-activity.js").SocialActivitySnapshot,
  // canonical_fields ya fusionados con la fuente social (P1/P3). Si se provee, se persisten
  // y se usan para tags/reliability; si no, se conservan los actuales.
  socialCanonical?: Record<string, unknown> | null,
  // N90: merge sobre el canonical FRESCO re-leído acá adentro — el snapshot del
  // pipeline podía revertir campos canónicos escritos por reconcile/refresh en el medio.
  socialCanonicalFn?: (freshCanonical: Lead["canonical_fields"]) => Record<string, unknown> | null
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
        ...(socialActivity !== undefined ? { social_activity: socialActivity } : {}),
        ...(contactEmails !== undefined ? { contact_emails: contactEmails } : {}),
      }
    : {
        fetched_at: fetchedAt,
        social_search: socialSearch,
        ...(socialActivity !== undefined ? { social_activity: socialActivity } : {}),
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
  const freshCanonical = (current?.canonical_fields as Lead["canonical_fields"]) ?? null;
  const mergedSocialCanonical = socialCanonicalFn
    ? socialCanonicalFn(freshCanonical)
    : socialCanonical;
  const canonicalFields =
    mergedSocialCanonical !== undefined && mergedSocialCanonical !== null
      ? (mergedSocialCanonical as Lead["canonical_fields"])
      : freshCanonical;
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
      ...(socialCanonical !== undefined && socialCanonical !== null
        ? { canonical_fields: socialCanonical }
        : {}),
    })
    .eq("id", leadId);
  if (error) throw new Error(`Failed to update social search for lead ${leadId}: ${error.message}`);
}

export async function updateLeadSocialEnrichStatus(
  leadId: string,
  status: "ok" | "blocked" | "no_data"
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

export async function loadLeadsByNiche(niche: string): Promise<Lead[]> {
  const db = getSupabase();
  const pageSize = 1000;
  const leads: Lead[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("leads")
      .select("*")
      .eq("niche", niche)
      .order("name")
      .range(from, to);

    if (error) throw new Error(`Failed to load leads for niche ${niche}: ${error.message}`);

    const batch = (data ?? []) as Lead[];
    leads.push(...batch);

    if (batch.length < pageSize) break;
  }

  return leads;
}

export type EnrichmentLeadFilterSelection = {
  contact_tier?: string;
  prospect_score_gte?: number;
  niche?: string;
  niche_expanded?: string[];
  source?: string;
  primary_offer?: string;
  q?: string;
  missing_gps?: boolean;
  missing_address?: boolean;
  missing_phone?: boolean;
  missing_whatsapp?: boolean;
  missing_email?: boolean;
  missing_website?: boolean;
};

function applyMissingFilters<Q extends { is: (col: string, val: null) => Q }>(
  query: Q,
  filters: EnrichmentLeadFilterSelection
): Q {
  if (filters.missing_gps) query = query.is("gps", null);
  if (filters.missing_address) query = query.is("address", null);
  if (filters.missing_phone) query = query.is("phone", null);
  if (filters.missing_whatsapp) query = query.is("whatsapp", null);
  if (filters.missing_email) query = query.is("contact_email", null);
  if (filters.missing_website) query = query.is("website", null);
  return query;
}

export async function countLeadsByFilterSelection(filters: EnrichmentLeadFilterSelection): Promise<number> {
  let query = getSupabase().from("lead_dashboard").select("id", { count: "exact", head: true });

  if (filters.contact_tier) query = query.eq("contact_tier", filters.contact_tier);
  if (filters.prospect_score_gte != null) query = query.gte("prospect_score", filters.prospect_score_gte);
  if (filters.niche_expanded && filters.niche_expanded.length > 0) {
    query = query.in("niche", filters.niche_expanded);
  } else if (filters.niche) {
    query = query.eq("niche", filters.niche);
  }
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.primary_offer) query = query.eq("primary_offer", filters.primary_offer);
  if (filters.q) query = query.textSearch("search_vector", filters.q, { type: "plain", config: "spanish" });
  query = applyMissingFilters(query, filters);

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count leads for filters: ${error.message}`);
  return count ?? 0;
}

// Supabase capa cada respuesta a max-rows (1000): la query de ids se pagina con range().
const FILTER_IDS_PAGE_SIZE = 1000;
// Un .in() con cientos de UUIDs rompe el límite de URL de PostgREST: se trae por lotes.
const FILTER_LEADS_ID_CHUNK = 200;

export async function loadLeadsByFilterSelection(
  filters: EnrichmentLeadFilterSelection,
  opts: { passedOnly?: boolean; limit?: number } = { passedOnly: true, limit: 250 }
): Promise<Lead[]> {
  const cap = opts.limit ?? 250;

  const buildDashboardQuery = () => {
    let dashboardQuery = getSupabase().from("lead_dashboard").select("id").order("created_at", { ascending: false });
    if (filters.contact_tier) dashboardQuery = dashboardQuery.eq("contact_tier", filters.contact_tier);
    if (filters.prospect_score_gte != null) dashboardQuery = dashboardQuery.gte("prospect_score", filters.prospect_score_gte);
    if (filters.niche_expanded && filters.niche_expanded.length > 0) {
      dashboardQuery = dashboardQuery.in("niche", filters.niche_expanded);
    } else if (filters.niche) {
      dashboardQuery = dashboardQuery.eq("niche", filters.niche);
    }
    if (filters.source) dashboardQuery = dashboardQuery.eq("source", filters.source);
    if (filters.primary_offer) dashboardQuery = dashboardQuery.eq("primary_offer", filters.primary_offer);
    if (filters.q) dashboardQuery = dashboardQuery.textSearch("search_vector", filters.q, { type: "plain", config: "spanish" });
    return applyMissingFilters(dashboardQuery, filters);
  };

  const ids: string[] = [];
  for (let from = 0; ids.length < cap; from += FILTER_IDS_PAGE_SIZE) {
    const to = Math.min(from + FILTER_IDS_PAGE_SIZE, cap) - 1;
    const { data: dashboardRows, error: dashboardError } = await buildDashboardQuery().range(from, to);
    if (dashboardError) throw new Error(`Failed to load lead ids for filters: ${dashboardError.message}`);
    const batch = (dashboardRows ?? [])
      .map((row) => (row as { id?: string }).id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    ids.push(...batch);
    if (batch.length < to - from + 1) break;
  }

  if (ids.length === 0) return [];

  const leads: Lead[] = [];
  for (let i = 0; i < ids.length; i += FILTER_LEADS_ID_CHUNK) {
    const chunk = ids.slice(i, i + FILTER_LEADS_ID_CHUNK);
    let query = getSupabase()
      .from("leads")
      .select("*")
      .in("id", chunk)
      .order("name")
      .limit(chunk.length);
    if (opts.passedOnly) query = query.eq("passed_filter", true);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load leads for filters: ${error.message}`);
    leads.push(...((data ?? []) as Lead[]));
  }

  // Orden global por nombre (cada lote viene ordenado, pero entre lotes no).
  return leads.sort((a, b) => a.name.localeCompare(b.name));
}

// Carga leads puntuales por id en lotes (mismo motivo que FILTER_LEADS_ID_CHUNK:
// un .in() gigante rompe el límite de URL). Usado por el re-score encadenado.
export async function loadLeadsByIds(ids: string[]): Promise<Lead[]> {
  if (ids.length === 0) return [];
  const db = getSupabase();
  const leads: Lead[] = [];
  for (let i = 0; i < ids.length; i += FILTER_LEADS_ID_CHUNK) {
    const chunk = ids.slice(i, i + FILTER_LEADS_ID_CHUNK);
    const { data, error } = await db
      .from("leads")
      .select("*")
      .in("id", chunk)
      .limit(chunk.length);
    if (error) throw new Error(`Failed to load leads by ids: ${error.message}`);
    leads.push(...((data ?? []) as Lead[]));
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

export async function loadLeadsByScoringVersion(scoringVersion: number): Promise<Lead[]> {
  const db = getSupabase();
  const pageSize = 1000;
  const leads: Lead[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("leads")
      .select("*")
      .eq("scoring_version", scoringVersion)
      .order("name")
      .range(from, to);

    if (error) throw new Error(`Failed to load leads for scoring_version=${scoringVersion}: ${error.message}`);
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
  const { error } = await db.rpc("merge_lead_company_data", {
    p_lead_id: leadId,
    p_patch: patch,
  });
  if (error) throw new Error(`merge_lead_company_data failed for ${leadId}: ${error.message}`);
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

export interface GooglePlacesRefreshInput {
  displayName?: { text?: string | undefined; languageCode?: string | undefined } | undefined;
  formattedAddress?: string | undefined;
  rating?: number | undefined;
  userRatingCount?: number | undefined;
  websiteUri?: string | undefined;
  internationalPhoneNumber?: string | undefined;
  businessStatus?: string | undefined;
  location?: { latitude?: number | undefined; longitude?: number | undefined } | undefined;
}

export interface GooglePlacesRefreshResult {
  fields_updated: string[];
}

export async function applyGooglePlacesRefresh(
  leadId: string,
  summary: GooglePlacesRefreshInput
): Promise<GooglePlacesRefreshResult> {
  const patch: Record<string, unknown> = {};
  const fields_updated: string[] = [];

  if (summary.displayName?.text) {
    patch.name = summary.displayName.text;
    fields_updated.push("name");
  }
  if (summary.formattedAddress !== undefined) {
    patch.address = summary.formattedAddress;
    fields_updated.push("address");
  }
  if (summary.rating !== undefined) {
    patch.rating = summary.rating;
    fields_updated.push("rating");
  }
  if (summary.userRatingCount !== undefined) {
    patch.review_count = summary.userRatingCount;
    fields_updated.push("review_count");
  }
  if (summary.internationalPhoneNumber !== undefined) {
    patch.phone = summary.internationalPhoneNumber;
    fields_updated.push("phone");
  }
  if (summary.websiteUri !== undefined) {
    patch.website = summary.websiteUri;
    fields_updated.push("website");
  }
  if (summary.businessStatus !== undefined) {
    patch.business_status = summary.businessStatus;
    fields_updated.push("business_status");
  }
  const lat = summary.location?.latitude;
  const lng = summary.location?.longitude;
  if (lat != null && lng != null) {
    patch.gps = `SRID=4326;POINT(${lng} ${lat})`;
    fields_updated.push("gps");
  }

  if (fields_updated.length === 0) return { fields_updated: [] };

  const { error } = await getSupabase()
    .from("leads")
    .update(patch)
    .eq("id", leadId);

  if (error) throw new Error(`applyGooglePlacesRefresh failed for lead ${leadId}: ${error.message}`);

  return { fields_updated };
}
