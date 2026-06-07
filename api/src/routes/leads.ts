import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser, type AuthUser } from "../auth/middleware.js";
import { createLLMProvider } from "../llm/factory.js";
import { countLeadsByFilterSelection, type EnrichmentLeadFilterSelection } from "../../../src/storage/leads.js";
import { expandNiche } from "../../../src/storage/niches.js";
import { startFilterEnrichmentJob } from "../../../src/cli/commands/enrich.js";
import { startReDiscoveryJob } from "../../../src/cli/commands/re-discover.js";
import { summarizeFeedbackRows, computeFeedbackAdjustedConfidence } from "../../../src/modules/feedback/summary.js";
import { loadSocialSnapshots } from "../../../src/storage/social-snapshots.js";
import { deriveSocialMetrics } from "../../../src/modules/social-enrich/social-history.js";
import {
  buildCommercialOfferings,
  buildCommercialOfferingsSummary,
  type CommercialOfferType,
  type CommercialOfferingsSummary,
} from "../../../src/modules/scoring/offerings.js";
import { createLeadGeocodingService } from "../services/lead-geocoding.js";
import {
  buildGridCell,
  buildLeadLocationKey,
  getPrimaryCoordinate,
  parseGranularLocationKey,
} from "./discovery-insights.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const CONTACT_TIERS = ["A", "B", "C", "D", "X"] as const;
type ContactTier = (typeof CONTACT_TIERS)[number];

const FILTER_ENRICH_LIMIT = 250;

const enrichCollectionSchema = z.object({
  contact_tier: z.enum(CONTACT_TIERS).optional(),
  prospect_score_gte: z.number().int().min(0).max(100).optional(),
  niche: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  primary_offer: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  missing_gps: z.boolean().optional(),
  missing_address: z.boolean().optional(),
  missing_phone: z.boolean().optional(),
  missing_whatsapp: z.boolean().optional(),
  missing_email: z.boolean().optional(),
  missing_website: z.boolean().optional(),
  mode: z.enum(["enrichment", "re_discovery"]).default("enrichment"),
  with_heuristic: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(8).default(4),
});

const REJECTION_REASONS = ["no_pertenece_al_lead", "dato_desactualizado", "fuera_de_servicio", "otro"] as const;

const leadFeedbackCreateSchema = z.object({
  field_key: z.string().trim().min(1).max(80),
  field_value: z.unknown().optional(),
  verdict: z.enum(["good", "bad"]),
  comment: z.string().trim().min(1).max(1000).optional(),
  rejection_reason: z.enum(REJECTION_REASONS).optional(),
  reassign_to_lead_id: z.string().uuid().optional(),
});

const favoriteContactsSchema = z.object({
  favorite_contacts: z
    .array(z.object({ kind: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(400) }))
    .max(50),
});

const leadFeedbackListQuerySchema = z.object({
  field_key: z.string().trim().min(1).max(80).optional(),
  include_rejected: z.enum(["true", "false"]).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

const leadFeedbackSummaryQuerySchema = z.object({
  include_rejected: z.enum(["true", "false"]).optional(),
});

function hasRelevantEnrichmentFilter(filters: EnrichmentLeadFilterSelection): boolean {
  return Boolean(
    filters.contact_tier ||
    filters.prospect_score_gte != null ||
    filters.niche ||
    filters.source ||
    filters.primary_offer ||
    filters.q ||
    filters.missing_gps ||
    filters.missing_address ||
    filters.missing_phone ||
    filters.missing_whatsapp ||
    filters.missing_email ||
    filters.missing_website
  );
}

async function loadAccessibleLeadForFeedback(
  authUser: AuthUser,
  leadId: string,
  includeRejected: boolean
): Promise<JsonRecord | null> {
  const db = getDb();

  let lead: Record<string, unknown> | null = null;
  if (includeRejected && authUser.role === "admin") {
    const { data, error } = await db.from("leads").select("*").eq("id", leadId).single();
    if (!error && data) lead = data as Record<string, unknown>;
  } else {
    const { data, error } = await db.from("lead_dashboard").select("*").eq("id", leadId).single();
    if (!error && data) lead = data as Record<string, unknown>;
  }

  if (!lead) return null;

  const normalizedLead = normalizeLeadRow(lead as JsonRecord);
  if (authUser.role === "cm") {
    if (!authUser.lead_filter || !passesLeadFilter(normalizedLead, authUser.lead_filter)) {
      return null;
    }
  }

  return normalizedLead;
}

async function writeLeadFeedbackAuditLog(
  request: FastifyRequest,
  leadId: string,
  feedbackId: string,
  payload: { field_key: string; verdict: "good" | "bad"; comment: string | null; field_value: unknown }
): Promise<void> {
  const db = getDb();
  const actor = getAuthUser(request);
  await db.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_role: actor.role,
    action: "lead.feedback.create",
    target_type: "lead",
    target_id: leadId,
    diff: {
      feedback_id: feedbackId,
      field_key: payload.field_key,
      verdict: payload.verdict,
      comment: payload.comment,
      field_value: payload.field_value ?? null,
      created_at: new Date().toISOString(),
    },
    ip_address: request.ip ?? null,
    user_agent: request.headers["user-agent"] ?? null,
  });
}

const listQuerySchema = z.object({
  contact_tier: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter((t): t is ContactTier =>
              CONTACT_TIERS.includes(t as ContactTier)
            )
        : (["A", "B", "C", "D"] as ContactTier[])
    ),
  prospect_score_gte: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().min(0).max(100).optional()),
  niche: z.string().optional(),
  source: z.string().optional(),
  primary_offer: z.string().optional(),
  commercial_offer_type: z.enum(["marketing", "software", "both", "unknown"]).optional(),
  q: z.string().optional(),
  location_key: z.string().trim().min(1).optional(),
  parent_location_key: z.string().trim().min(1).optional(),
  grid_location_key: z.string().trim().min(1).optional(),
  parent_location_keys: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : []
    ),
  grid_location_keys: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : []
    ),
  sort_by: z.enum(["created_at", "prospect_score", "marketing_score", "software_score", "offer_balance"]).optional().default("created_at"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

type JsonRecord = Record<string, unknown>;
type CorroboratingSourceRecord = {
  source: string;
  external_id: string;
  confidence: number;
};

type FieldEvidenceRecord = {
  source: string;
  label: string;
  external_id: string | null;
  confidence: number | null;
  role: "primary" | "confirming" | "derived";
  note: string | null;
};

type LeadFieldSourceRecord = {
  label: string;
  value: string | number | boolean | null;
  source: string | null;
  confidence: number | null;
  confirmations: number;
  evidence: FieldEvidenceRecord[];
};

type CommercialEvidenceNode = {
  id: string;
  title: string;
  summary: string;
  strength: "high" | "medium" | "low";
  source: string | null;
  confirmations: number;
  evidence: string[];
  children?: CommercialEvidenceNode[];
};

type LeadSortBy = "created_at" | "prospect_score" | "marketing_score" | "software_score" | "offer_balance";
type LeadSortDirection = "asc" | "desc";
type LeadCursorPayload = {
  sort_by: LeadSortBy;
  sort_direction: LeadSortDirection;
  id: string;
  created_at: string;
  prospect_score: number | null;
  marketing_score: number | null;
  software_score: number | null;
  offer_balance: number | null;
};

type GeoSelection = {
  parentLocationKeys: string[];
  gridLocationKeys: string[];
};

function buildGeoSelection(params: {
  location_key?: string;
  parent_location_key?: string;
  grid_location_key?: string;
  parent_location_keys?: string[];
  grid_location_keys?: string[];
}): GeoSelection {
  const parentLocationKeys = new Set((params.parent_location_keys ?? []).filter(Boolean));
  const gridLocationKeys = new Set((params.grid_location_keys ?? []).filter(Boolean));

  if (params.parent_location_key) parentLocationKeys.add(params.parent_location_key);
  if (params.grid_location_key) gridLocationKeys.add(params.grid_location_key);

  if (params.location_key) {
    const parsed = parseGranularLocationKey(params.location_key);
    if (parsed.parent_location_key) {
      parentLocationKeys.add(parsed.parent_location_key);
      if (parsed.grid_location_key) gridLocationKeys.add(parsed.grid_location_key);
    } else {
      parentLocationKeys.add(params.location_key);
    }
  }

  return {
    parentLocationKeys: [...parentLocationKeys],
    gridLocationKeys: [...gridLocationKeys],
  };
}

function getLeadCommercialOfferings(lead: JsonRecord) {
  const existing = lead["commercial_offerings"];
  if (isRecord(existing) && Array.isArray(existing["software"]) && Array.isArray(existing["marketing"])) {
    return existing as unknown as ReturnType<typeof buildCommercialOfferings>;
  }
  return buildCommercialOfferings(
    asStringArray(lead["tags"]),
    isRecord(lead["score_breakdown"]) ? (lead["score_breakdown"] as Record<string, unknown>) : null,
    isRecord(lead["digital_footprint"]) ? (lead["digital_footprint"] as Record<string, unknown>) : null
  );
}

function getLeadCommercialSummary(lead: JsonRecord): CommercialOfferingsSummary {
  const existing = lead["commercial_offers_summary"];
  if (isRecord(existing)) {
    const primary = (existing["primary_offer_type"] as CommercialOfferType | undefined) ?? "unknown";
    const software = asNullableNumber(existing["software_score"]) ?? 0;
    const marketing = asNullableNumber(existing["marketing_score"]) ?? 0;
    // Salvaguarda: leads viejos pueden tener primary_offer_type no-unknown pero scores en 0
    // (resumen persistido inconsistente). El filtro inclusivo por score los excluiría
    // erróneamente; recalculamos desde la evidencia en ese caso.
    if (primary !== "unknown" && software === 0 && marketing === 0) {
      return buildCommercialOfferingsSummary(getLeadCommercialOfferings(lead));
    }
    return {
      primary_offer_type: primary,
      software_score: software,
      marketing_score: marketing,
      top_software_offer: asNullableString(existing["top_software_offer"]),
      top_marketing_offer: asNullableString(existing["top_marketing_offer"]),
      top_software_label: asNullableString(existing["top_software_label"]),
      top_marketing_label: asNullableString(existing["top_marketing_label"]),
      evidence_count: asNullableNumber(existing["evidence_count"]) ?? 0,
    };
  }
  return buildCommercialOfferingsSummary(getLeadCommercialOfferings(lead));
}

function getLeadSortMetric(lead: JsonRecord, sortBy: LeadSortBy): number | null {
  if (sortBy === "prospect_score") {
    return asNullableNumber(lead["prospect_score"]);
  }
  const summary = getLeadCommercialSummary(lead);
  if (sortBy === "marketing_score") return summary.marketing_score;
  if (sortBy === "software_score") return summary.software_score;
  if (sortBy === "offer_balance") return Math.abs(summary.software_score - summary.marketing_score);
  return null;
}

// Matching inclusivo por capacidad (no por etiqueta): filtrar por "marketing" debe incluir
// a los leads de doble oferta (marketing+software). "both" exige ambas capacidades.
export function commercialSummaryMatchesOffer(
  summary: Pick<CommercialOfferingsSummary, "primary_offer_type" | "software_score" | "marketing_score">,
  commercialOfferType: CommercialOfferType | undefined
): boolean {
  if (!commercialOfferType) return true;
  switch (commercialOfferType) {
    case "marketing":
      return summary.marketing_score > 0;
    case "software":
      return summary.software_score > 0;
    case "both":
      return summary.marketing_score > 0 && summary.software_score > 0;
    case "unknown":
      return summary.primary_offer_type === "unknown";
    default:
      return false;
  }
}

function matchesCommercialOfferType(
  lead: JsonRecord,
  commercialOfferType: CommercialOfferType | undefined
): boolean {
  if (!commercialOfferType) return true;
  return commercialSummaryMatchesOffer(getLeadCommercialSummary(lead), commercialOfferType);
}

function isDerivedCommercialSort(sortBy: LeadSortBy): boolean {
  return sortBy === "marketing_score" || sortBy === "software_score" || sortBy === "offer_balance";
}

function encodeLeadCursor(payload: LeadCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeLeadCursor(value: string): LeadCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    const id = asNullableString(parsed["id"]);
    const createdAt = asNullableString(parsed["created_at"]);
    const sortBy = parsed["sort_by"];
    const sortDirection = parsed["sort_direction"];
    if (!id || !createdAt) return null;
    if (sortBy !== "created_at" && sortBy !== "prospect_score" && sortBy !== "marketing_score" && sortBy !== "software_score" && sortBy !== "offer_balance") return null;
    if (sortDirection !== "asc" && sortDirection !== "desc") return null;
    return {
      sort_by: sortBy,
      sort_direction: sortDirection,
      id,
      created_at: createdAt,
      prospect_score: asNullableNumber(parsed["prospect_score"]),
      marketing_score: asNullableNumber(parsed["marketing_score"]),
      software_score: asNullableNumber(parsed["software_score"]),
      offer_balance: asNullableNumber(parsed["offer_balance"]),
    };
  } catch {
    return null;
  }
}

async function resolveLeadCursor(
  db: ReturnType<typeof getDb>,
  rawCursor: string,
  sortBy: LeadSortBy,
  sortDirection: LeadSortDirection
): Promise<LeadCursorPayload | null> {
  const decoded = decodeLeadCursor(rawCursor);
  if (decoded) return decoded;
  if (!permissiveUuid.safeParse(rawCursor).success) return null;

  const { data } = await db
    .from("lead_dashboard")
    .select("*")
    .eq("id", rawCursor)
    .maybeSingle();

  if (!data || typeof data !== "object") return null;
  const normalized = normalizeLeadRow(data as JsonRecord);
  return {
    sort_by: sortBy,
    sort_direction: sortDirection,
    id: asNullableString(normalized["id"]) ?? rawCursor,
    created_at: asNullableString(normalized["created_at"]) ?? new Date(0).toISOString(),
    prospect_score: asNullableNumber(normalized["prospect_score"]),
    marketing_score: getLeadCommercialSummary(normalized).marketing_score,
    software_score: getLeadCommercialSummary(normalized).software_score,
    offer_balance: Math.abs(getLeadCommercialSummary(normalized).software_score - getLeadCommercialSummary(normalized).marketing_score),
  };
}

function compareLeadRows(
  left: JsonRecord,
  right: JsonRecord,
  sortBy: LeadSortBy,
  sortDirection: LeadSortDirection
): number {
  const ascending = sortDirection === "asc";

  if (sortBy !== "created_at") {
    const leftScore = getLeadSortMetric(left, sortBy);
    const rightScore = getLeadSortMetric(right, sortBy);
    if (leftScore !== rightScore) {
      if (leftScore == null) return 1;
      if (rightScore == null) return -1;
      return ascending ? leftScore - rightScore : rightScore - leftScore;
    }
  }

  const leftCreatedAt = asNullableString(left["created_at"]) ?? "";
  const rightCreatedAt = asNullableString(right["created_at"]) ?? "";
  if (leftCreatedAt !== rightCreatedAt) {
    return ascending
      ? leftCreatedAt.localeCompare(rightCreatedAt)
      : rightCreatedAt.localeCompare(leftCreatedAt);
  }

  const leftId = asNullableString(left["id"]) ?? "";
  const rightId = asNullableString(right["id"]) ?? "";
  return ascending ? leftId.localeCompare(rightId) : rightId.localeCompare(leftId);
}

function isLeadRowAfterCursor(
  row: JsonRecord,
  cursor: LeadCursorPayload,
  sortBy: LeadSortBy,
  sortDirection: LeadSortDirection
): boolean {
  const ascending = sortDirection === "asc";

  if (sortBy !== "created_at") {
    const rowScore = getLeadSortMetric(row, sortBy);
    const cursorScore =
      sortBy === "prospect_score"
        ? cursor.prospect_score
        : sortBy === "marketing_score"
          ? cursor.marketing_score
          : sortBy === "software_score"
            ? cursor.software_score
            : cursor.offer_balance;
    if (rowScore !== cursorScore) {
      if (rowScore == null) return false;
      if (cursorScore == null) return true;
      return ascending ? rowScore > cursorScore : rowScore < cursorScore;
    }
  }

  const rowCreatedAt = asNullableString(row["created_at"]) ?? "";
  if (rowCreatedAt !== cursor.created_at) {
    return ascending ? rowCreatedAt > cursor.created_at : rowCreatedAt < cursor.created_at;
  }

  const rowId = asNullableString(row["id"]) ?? "";
  return ascending ? rowId > cursor.id : rowId < cursor.id;
}

async function matchesGeoSelection(
  lead: JsonRecord,
  selection: GeoSelection,
  geocodeAddress: (address: string) => Promise<{ lat: number; lng: number } | null>
): Promise<boolean> {
  if (selection.parentLocationKeys.length === 0 && selection.gridLocationKeys.length === 0) {
    return true;
  }

  const parentLocationKey = buildLeadLocationKey(asNullableString(lead["address"]));
  if (selection.parentLocationKeys.length > 0 && !selection.parentLocationKeys.includes(parentLocationKey)) {
    return false;
  }

  if (selection.gridLocationKeys.length === 0) {
    return true;
  }

  const rawCoordinate = getPrimaryCoordinate({
    id: asNullableString(lead["id"]) ?? "",
    source: asNullableString(lead["source"]),
    niche: asNullableString(lead["niche"]),
    address: asNullableString(lead["address"]),
    prospect_score: asNullableNumber(lead["prospect_score"]),
    contact_tier: asNullableString(lead["contact_tier"]),
    gps: lead["gps"],
    corroborating_sources: lead["corroborating_sources"] ?? [],
  });

  const geocodedCoordinate = !rawCoordinate && asNullableString(lead["address"])
    ? await geocodeAddress(asNullableString(lead["address"]) ?? "")
    : null;
  const coordinate = rawCoordinate ?? (geocodedCoordinate ? { ...geocodedCoordinate, source: "geocoded" as const } : null);
  if (!coordinate) return false;

  const cell = buildGridCell(coordinate);
  return selection.gridLocationKeys.includes(cell.gridKey);
}

function describeGeoSelection(selection: GeoSelection): string | null {
  if (selection.gridLocationKeys.length > 0 && selection.parentLocationKeys.length > 0) {
    return `${selection.parentLocationKeys[0]}::${selection.gridLocationKeys[0]}`;
  }
  if (selection.parentLocationKeys.length > 0) return selection.parentLocationKeys.join(",");
  if (selection.gridLocationKeys.length > 0) return selection.gridLocationKeys.join(",");
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function titleCase(value: string): string {
  return value
    .split(/[\_\-\s]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function humanizeSource(source: string | null): string {
  if (!source) return "Fuente no identificada";
  switch (source) {
    case "google_places":
      return "Google Places";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "website":
      return "Website";
    case "manual":
      return "Carga manual";
    case "scoring_engine":
      return "Motor de scoring";
    case "inference_engine":
      return "Motor de inferencia";
    default:
      return titleCase(source);
  }
}

function canonicalFieldRecord(
  canonicalFields: JsonRecord | null,
  field: "email" | "phone" | "website"
): JsonRecord | null {
  if (!canonicalFields) return null;
  const raw = canonicalFields[field];
  return isRecord(raw) ? raw : null;
}

function canonicalFieldValue(
  canonicalFields: JsonRecord | null,
  field: "email" | "phone" | "website"
): string | null {
  if (!canonicalFields) return null;
  const raw = canonicalFields[field];
  if (typeof raw === "string") return asNullableString(raw);
  if (isRecord(raw)) return asNullableString(raw["value"]);
  return null;
}

function scoreBreakdownValue(row: JsonRecord, key: string): string | null {
  const direct = asNullableString(row[key]);
  if (direct) return direct;
  const breakdown = isRecord(row["score_breakdown"]) ? row["score_breakdown"] : null;
  return breakdown ? asNullableString(breakdown[key]) : null;
}

function asCorroboratingSources(value: unknown): CorroboratingSourceRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      source: asNullableString(item["source"]) ?? "unknown",
      external_id: asNullableString(item["external_id"]) ?? "",
      confidence: asNullableNumber(item["confidence"]) ?? 0,
    }));
}

function normalizeScalarValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return asNullableString(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function dedupeEvidence(items: FieldEvidenceRecord[]): FieldEvidenceRecord[] {
  const seen = new Set<string>();
  const result: FieldEvidenceRecord[] = [];
  for (const item of items) {
    const key = [item.source, item.external_id ?? "", item.role, item.note ?? ""].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function corroboratingEvidence(sources: CorroboratingSourceRecord[]): FieldEvidenceRecord[] {
  return sources.map((entry) => ({
    source: entry.source,
    label: humanizeSource(entry.source),
    external_id: entry.external_id || null,
    confidence: entry.confidence,
    role: "confirming",
    note: null,
  }));
}

function evidenceFromCanonicalField(value: unknown): FieldEvidenceRecord[] {
  if (!isRecord(value)) return [];
  const primarySource =
    asNullableString(value["source"]) ??
    asNullableString(value["origin"]) ??
    asNullableString(value["provider"]);
  const primary = primarySource
    ? [{
        source: primarySource,
        label: humanizeSource(primarySource),
        external_id:
          asNullableString(value["external_id"]) ??
          asNullableString(value["externalId"]),
        confidence: asNullableNumber(value["confidence"]),
        role: "primary" as const,
        note: null,
      }]
    : [];

  const nested = ["confirmed_by", "confirmations", "sources", "evidence"]
    .flatMap((key) => {
      const raw = value[key];
      return Array.isArray(raw) ? raw : [];
    })
    .filter(isRecord)
    .map((item) => {
      const source =
        asNullableString(item["source"]) ??
        asNullableString(item["origin"]) ??
        asNullableString(item["provider"]) ??
        "unknown";
      return {
        source,
        label: humanizeSource(source),
        external_id:
          asNullableString(item["external_id"]) ??
          asNullableString(item["externalId"]),
        confidence: asNullableNumber(item["confidence"]),
        role: "confirming" as const,
        note: asNullableString(item["note"]),
      };
    });

  return dedupeEvidence([...primary, ...nested]);
}

function buildFieldSource(args: {
  label: string;
  value: unknown;
  canonicalField?: JsonRecord | null;
  primarySource?: string | null;
  fallbackConfidence?: number | null;
  corroboratingSources?: CorroboratingSourceRecord[];
  derivedNote?: string | null;
}): LeadFieldSourceRecord {
  const normalizedValue = normalizeScalarValue(args.value);
  const evidence: FieldEvidenceRecord[] = [];

  if (args.canonicalField) {
    evidence.push(...evidenceFromCanonicalField(args.canonicalField));
  }

  if (args.primarySource && evidence.length === 0 && normalizedValue !== null) {
    evidence.push({
      source: args.primarySource,
      label: humanizeSource(args.primarySource),
      external_id: null,
      confidence: args.fallbackConfidence ?? null,
      role: args.derivedNote ? "derived" : "primary",
      note: args.derivedNote ?? null,
    });
  }

  if (args.derivedNote && evidence.length > 0) {
    const firstEvidence = evidence[0];
    if (firstEvidence) {
      evidence[0] = {
        ...firstEvidence,
        role: firstEvidence.role === "confirming" ? "derived" : firstEvidence.role,
        note: firstEvidence.note ?? args.derivedNote,
      };
    }
  }

  evidence.push(...corroboratingEvidence(args.corroboratingSources ?? []));

  const deduped = dedupeEvidence(evidence);
  const primary = deduped.find((item) => item.role !== "confirming") ?? deduped[0] ?? null;

  return {
    label: args.label,
    value: normalizedValue,
    source: primary?.source ?? null,
    confidence: primary?.confidence ?? args.fallbackConfidence ?? null,
    confirmations: deduped.filter((item) => item.role === "confirming").length,
    evidence: deduped,
  };
}

function inferenceSignals(inferredState: JsonRecord | null): string[] {
  if (!inferredState) return [];
  return Object.entries(inferredState)
    .flatMap(([key, value]) => {
      if (!isRecord(value) || value["value"] !== true) return [];
      const confidence = asNullableNumber(value["confidence"]);
      return [`${titleCase(key)}${confidence != null ? ` (${Math.round(confidence * 100)}%)` : ""}`];
    })
    .slice(0, 4);
}

function digitalSignals(digitalFootprint: JsonRecord | null): string[] {
  if (!digitalFootprint) return [];
  const signals: string[] = [];
  const emailQuality = Array.isArray(digitalFootprint["email_quality"])
    ? (digitalFootprint["email_quality"] as unknown[])
        .filter(isRecord)
        .map((entry) => asNullableString(entry["quality"]))
        .filter((entry): entry is string => Boolean(entry) && entry !== "unknown")
    : [];
  if (emailQuality.length > 0) {
    signals.push(`Calidad de email: ${emailQuality[0]}`);
  }
  const phoneTypes = Array.isArray(digitalFootprint["phone_classification"])
    ? (digitalFootprint["phone_classification"] as unknown[])
        .filter(isRecord)
        .map((entry) => asNullableString(entry["type"]))
        .filter((entry): entry is string => Boolean(entry) && entry !== "unknown")
    : [];
  if (phoneTypes.length > 0) {
    signals.push(`Tipo de teléfono: ${phoneTypes[0]}`);
  }
  const lastChange = isRecord(digitalFootprint["last_change_diff"])
    ? Object.keys(digitalFootprint["last_change_diff"] as Record<string, unknown>).slice(0, 3)
    : [];
  if (lastChange.length > 0) {
    signals.push(`Cambios recientes detectados: ${lastChange.join(", ")}`);
  }
  const level = asNullableString(digitalFootprint["digitalization_level"]);
  if (level) {
    signals.push(`Nivel digital: ${level}`);
  }
  return signals;
}

function evidenceStrength(score: number | null, ready: boolean | null): "high" | "medium" | "low" {
  if ((score ?? 0) >= 75 || ready === true) return "high";
  if ((score ?? 0) >= 50) return "medium";
  return "low";
}

function buildCommercialEvidenceTree(
  normalizedLead: JsonRecord,
  fieldSources: Record<string, LeadFieldSourceRecord>
): CommercialEvidenceNode[] {
  const companyData = isRecord(normalizedLead["lead_company_data"]) ? normalizedLead["lead_company_data"] : null;
  const digitalFootprint = isRecord(normalizedLead["digital_footprint"]) ? normalizedLead["digital_footprint"] : null;
  const inferredState = isRecord(normalizedLead["inferred_state"]) ? normalizedLead["inferred_state"] : null;
  const score = asNullableNumber(normalizedLead["prospect_score"]);
  const contactReady = asBooleanOrNull(normalizedLead["contact_ready"]);
  const offerTrace = fieldSources["primary_offer"];
  const urgencyTrace = fieldSources["urgency_signal"];
  const contactTrace = fieldSources["contact_ready"];
  const detectedSubNiche = companyData ? asNullableString(companyData["detected_sub_niche"]) : null;
  const digitalizationLevel = companyData ? asNullableString(companyData["digitalization_level"]) : null;

  return [
    {
      id: "offer",
      title: "Oferta y ángulo de entrada",
      summary: typeof offerTrace?.value === "string" ? offerTrace.value : "Sin oferta sugerida",
      strength: evidenceStrength(score, contactReady),
      source: offerTrace?.source ?? null,
      confirmations: offerTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["pitch_hook"] === "string" ? `Pitch hook: ${normalizedLead["pitch_hook"]}` : null,
        typeof normalizedLead["top_buyer_type"] === "string" ? `Buyer probable: ${normalizedLead["top_buyer_type"]}` : null,
        detectedSubNiche ? `Subnicho detectado: ${detectedSubNiche}` : null,
        typeof normalizedLead["niche"] === "string" ? `Rubro: ${normalizedLead["niche"]}` : null,
      ].filter((item): item is string => Boolean(item)),
    },
    {
      id: "contact",
      title: "Readiness de contacto",
      summary:
        contactReady === true
          ? "El lead parece listo para primer contacto"
          : contactReady === false
            ? "Conviene validar contacto antes de salir a vender"
            : "No hay certeza sobre la calidad del contacto",
      strength: evidenceStrength(score, contactReady),
      source: contactTrace?.source ?? null,
      confirmations: contactTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["contact_tier"] === "string" ? `Tier: ${normalizedLead["contact_tier"]}` : null,
        normalizedLead["phone"] ? "Tiene teléfono" : null,
        normalizedLead["whatsapp"] ? "Tiene WhatsApp" : null,
        normalizedLead["email"] ? "Tiene email" : null,
        normalizedLead["website"] ? "Tiene website" : null,
        asNullableNumber(normalizedLead["contact_reliability_score"])
          ? `Confiabilidad contacto: ${Math.round(((normalizedLead["contact_reliability_score"] as number) ?? 0) * 100)}%`
          : null,
        ...digitalSignals(digitalFootprint),
      ].filter((item): item is string => Boolean(item)),
    },
    {
      id: "urgency",
      title: "Señales de timing",
      summary: typeof urgencyTrace?.value === "string" ? urgencyTrace.value : "Sin urgencia explícita detectada",
      strength: urgencyTrace?.value ? "medium" : "low",
      source: urgencyTrace?.source ?? null,
      confirmations: urgencyTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["business_status"] === "string" ? `Estado comercial: ${normalizedLead["business_status"]}` : null,
        digitalizationLevel ? `Nivel digital: ${digitalizationLevel}` : null,
        ...inferenceSignals(inferredState),
      ].filter((item): item is string => Boolean(item)),
    },
  ];
}

function buildFieldSources(
  normalizedLead: JsonRecord,
  canonicalFields: JsonRecord | null,
  corroboratingSources: CorroboratingSourceRecord[]
): Record<string, LeadFieldSourceRecord> {
  const canonicalSource = asNullableString(normalizedLead["canonical_source"]);
  const source = asNullableString(normalizedLead["source"]);
  const baseSource = canonicalSource ?? source ?? "unknown";
  const sourceConfidence = asNullableNumber(normalizedLead["source_confidence"]);
  const dataConfidence = asNullableNumber(normalizedLead["data_confidence_score"]);
  const contactReliability = asNullableNumber(normalizedLead["contact_reliability_score"]);

  return {
    name: buildFieldSource({ label: "Nombre comercial", value: normalizedLead["name"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    niche: buildFieldSource({ label: "Rubro", value: normalizedLead["niche"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    address: buildFieldSource({ label: "Dirección", value: normalizedLead["address"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    phone: buildFieldSource({ label: "Teléfono", value: normalizedLead["phone"], canonicalField: canonicalFieldRecord(canonicalFields, "phone"), primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    whatsapp: buildFieldSource({ label: "WhatsApp", value: normalizedLead["whatsapp"], primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    email: buildFieldSource({ label: "Email", value: normalizedLead["email"], canonicalField: canonicalFieldRecord(canonicalFields, "email"), primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    website: buildFieldSource({ label: "Website", value: normalizedLead["website"], canonicalField: canonicalFieldRecord(canonicalFields, "website"), primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    rating: buildFieldSource({ label: "Rating público", value: normalizedLead["rating"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    review_count: buildFieldSource({ label: "Cantidad de reseñas", value: normalizedLead["review_count"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    primary_offer: buildFieldSource({ label: "Oferta sugerida", value: normalizedLead["primary_offer"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Derivada desde score_breakdown y señales comerciales." }),
    pitch_hook: buildFieldSource({ label: "Pitch hook", value: normalizedLead["pitch_hook"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Ángulo comercial sugerido a partir de señales del lead." }),
    urgency_signal: buildFieldSource({ label: "Urgencia", value: normalizedLead["urgency_signal"], primarySource: "inference_engine", fallbackConfidence: dataConfidence, derivedNote: "Inferida desde estado del negocio y huella digital." }),
    contact_ready: buildFieldSource({ label: "Contacto listo", value: normalizedLead["contact_ready"], primarySource: "scoring_engine", fallbackConfidence: contactReliability, derivedNote: "Evaluación compuesta de calidad de contacto y señales de negocio." }),
    contact_tier: buildFieldSource({ label: "Tier de contacto", value: normalizedLead["contact_tier"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Clasificación comercial operativa." }),
    top_buyer_type: buildFieldSource({ label: "Buyer probable", value: normalizedLead["top_buyer_type"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Inferido para orientar la conversación comercial." }),
    business_status: buildFieldSource({ label: "Estado comercial", value: normalizedLead["business_status"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
  };
}

function normalizeLeadRow(row: JsonRecord): JsonRecord {
  const canonicalFields = isRecord(row["canonical_fields"]) ? row["canonical_fields"] : null;
  const corroboratingSources = asCorroboratingSources(row["corroborating_sources"]);

  const normalized: JsonRecord = {
    id: asNullableString(row["id"]) ?? "",
    name: asNullableString(row["name"]) ?? "",
    niche: asNullableString(row["niche"]),
    source: asNullableString(row["source"]) ?? "unknown",
    canonical_source: asNullableString(row["canonical_source"]),
    address: asNullableString(row["address"]),
    phone:
      asNullableString(row["phone"]) ??
      asNullableString(row["contact_phone"]) ??
      canonicalFieldValue(canonicalFields, "phone"),
    whatsapp: asNullableString(row["whatsapp"]) ?? asNullableString(row["contact_whatsapp"]),
    email: asNullableString(row["email"]) ?? canonicalFieldValue(canonicalFields, "email"),
    website:
      asNullableString(row["website"]) ??
      canonicalFieldValue(canonicalFields, "website"),
    rating: asNullableNumber(row["rating"]),
    review_count: asNullableNumber(row["review_count"]),
    tags: asStringArray(row["tags"]),
    state: asNullableString(row["state"]) ?? "discovered",
    business_status: asNullableString(row["business_status"]),
    source_confidence: asNullableNumber(row["source_confidence"]),
    data_confidence_score: asNullableNumber(row["data_confidence_score"]),
    contact_reliability_score: asNullableNumber(row["contact_reliability_score"]),
    contact_ready: asBooleanOrNull(row["contact_ready"]),
    prospect_score: asNullableNumber(row["prospect_score"]),
    contact_tier: scoreBreakdownValue(row, "contact_tier"),
    primary_offer: scoreBreakdownValue(row, "primary_offer"),
    pitch_hook: scoreBreakdownValue(row, "pitch_hook"),
    urgency_signal: scoreBreakdownValue(row, "urgency_signal"),
    contacted_at: asNullableString(row["contacted_at"]),
    contacted_by: asNullableString(row["contacted_by"]),
    created_at: asNullableString(row["created_at"]) ?? "",
    corroborating_sources: corroboratingSources,
    top_buyer_type: asNullableString(row["top_buyer_type"]),
    top_buyer_score: asNullableNumber(row["top_buyer_score"]),
    owner_group_id: asNullableString(row["owner_group_id"]),
    notes: asNullableString(row["notes"]),
    digital_footprint: isRecord(row["digital_footprint"]) ? row["digital_footprint"] : null,
    inferred_state: isRecord(row["inferred_state"]) ? row["inferred_state"] : null,
    score_breakdown: isRecord(row["score_breakdown"]) ? row["score_breakdown"] : null,
    lead_company_data: isRecord(row["lead_company_data"]) ? row["lead_company_data"] : null,
    canonical_fields: canonicalFields,
    search_vector: row["search_vector"] ?? null,
    sources_count: asNullableNumber(row["sources_count"]) ?? corroboratingSources.length,
  };

  const fieldSources = buildFieldSources(normalized, canonicalFields, corroboratingSources);
  const commercialOfferings = buildCommercialOfferings(
    asStringArray(normalized["tags"]),
    isRecord(normalized["score_breakdown"]) ? normalized["score_breakdown"] : null,
    isRecord(normalized["digital_footprint"]) ? normalized["digital_footprint"] : null
  );
  return {
    ...normalized,
    field_sources: fieldSources,
    commercial_evidence_tree: buildCommercialEvidenceTree(normalized, fieldSources),
    commercial_offerings: commercialOfferings,
    commercial_offers_summary: buildCommercialOfferingsSummary(commercialOfferings),
  };
}

const ACTIVE_TRACKING_STATUSES = ["pending", "validation", "contact", "observed"] as const;

function isContactFieldKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    normalized === "emails" ||
    normalized.includes("phone") ||
    normalized.includes("whatsapp") ||
    normalized.includes("mobile") ||
    normalized.includes("email") ||
    normalized.includes("mail")
  );
}

function redactContactValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return "***";
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => redactContactValue(entry));
  if (!isRecord(value)) return value;

  const next: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = isContactFieldKey(key) ? redactContactContainer(entry) : redactNestedContactData(entry);
  }
  return next;
}

function redactContactContainer(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return "***";
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactContactContainer(entry));
  }
  if (!isRecord(value)) return value;

  const next: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "source" ||
      key === "confidence" ||
      key === "confirmations" ||
      key === "label" ||
      key === "role" ||
      key === "external_id" ||
      key === "note"
    ) {
      next[key] = entry;
      continue;
    }
    next[key] = isContactFieldKey(key) ? redactContactContainer(entry) : redactContactValue(entry);
  }
  return next;
}

function redactNestedContactData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactNestedContactData(entry));
  }
  if (!isRecord(value)) {
    return value;
  }

  const next: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = isContactFieldKey(key)
      ? redactContactContainer(entry)
      : redactNestedContactData(entry);
  }
  return next;
}

function redactContactFields(lead: JsonRecord): JsonRecord {
  return {
    ...lead,
    phone:    lead["phone"]    != null ? "***" : null,
    whatsapp: lead["whatsapp"] != null ? "***" : null,
    email:    lead["email"]    != null ? "***" : null,
    // Also redact field_sources so the UI doesn't leak values via evidence.
    field_sources: isRecord(lead["field_sources"])
      ? {
          ...(lead["field_sources"] as JsonRecord),
          phone:    null,
          whatsapp: null,
          email:    null,
        }
      : lead["field_sources"],
    canonical_fields: redactNestedContactData(lead["canonical_fields"]),
    digital_footprint: redactNestedContactData(lead["digital_footprint"]),
    lead_company_data: redactNestedContactData(lead["lead_company_data"]),
  };
}

async function getCmActiveTrackedLeadIds(userId: string, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();

  const db = getDb();
  const { data } = await db
    .from("lead_tracking")
    .select("lead_id")
    .eq("owner_id", userId)
    .in("status", [...ACTIVE_TRACKING_STATUSES])
    .in("lead_id", leadIds);

  return new Set(((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id));
}

async function fetchLeadGpsByIds(db: ReturnType<typeof getDb>, leadIds: string[]): Promise<Map<string, unknown>> {
  const gpsById = new Map<string, unknown>();
  if (leadIds.length === 0) return gpsById;

  const chunkSize = 100;
  for (let index = 0; index < leadIds.length; index += chunkSize) {
    const chunk = leadIds.slice(index, index + chunkSize);
    const { data, error } = await db.from("leads").select("id, gps").in("id", chunk);
    if (error) continue;
    for (const row of data ?? []) {
      const record = row as JsonRecord;
      const id = asNullableString(record["id"]);
      if (id) gpsById.set(id, record["gps"] ?? null);
    }
  }

  return gpsById;
}

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  const leadGeocodingService = createLeadGeocodingService();

  app.get(
    "/leads",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const parseResult = listQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid query parameters",
          error_code: "invalid_query",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const {
        contact_tier,
        prospect_score_gte,
        niche,
        source,
        primary_offer,
        commercial_offer_type,
        q,
        location_key,
        parent_location_key,
        grid_location_key,
        parent_location_keys,
        grid_location_keys,
        sort_by,
        sort_direction,
        cursor,
        limit,
      } = parseResult.data;
      const geoSelection = buildGeoSelection({
        location_key,
        parent_location_key,
        grid_location_key,
        parent_location_keys,
        grid_location_keys,
      });
      const geoSelectionActive = geoSelection.parentLocationKeys.length > 0 || geoSelection.gridLocationKeys.length > 0;
      const requiresDerivedLeadPath = geoSelectionActive || commercial_offer_type !== undefined || isDerivedCommercialSort(sort_by);

      const db = getDb();

      // Build Supabase query from lead_dashboard VIEW
      let query = db.from("lead_dashboard").select("*", { count: "exact" });

      // Apply CM lead_filter (must be applied before request filters — intersection)
      if (authUser.role === "cm") {
        if (!authUser.lead_filter) {
          // CM with null lead_filter sees nothing (fail closed)
          return reply.status(200).send({ data: [], next_cursor: null, total: 0 });
        }
        // Apply contact_tier from lead_filter as intersection
        const filterTiers = authUser.lead_filter["contact_tier"];
        if (Array.isArray(filterTiers) && filterTiers.length > 0) {
          const effectiveTiers = contact_tier.filter((t) =>
            filterTiers.includes(t)
          );
          if (effectiveTiers.length === 0) {
            return reply.status(200).send({ data: [], next_cursor: null, total: 0 });
          }
          query = query.in("contact_tier", effectiveTiers);
        } else {
          query = query.in("contact_tier", contact_tier);
        }
      } else {
        query = query.in("contact_tier", contact_tier);
      }

      if (prospect_score_gte !== undefined) {
        query = query.gte("prospect_score", prospect_score_gte);
      }
      if (niche) {
        query = query.eq("niche", niche);
      }
      if (source) {
        query = query.eq("source", source);
      }
      if (primary_offer) {
        query = query.eq("primary_offer", primary_offer);
      }
      if (q) {
        query = query.textSearch("search_vector", q, { type: "plain", config: "spanish" });
      }

      if (requiresDerivedLeadPath) {
        const fallbackQuery = query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(5000);
        const { data, error } = await fallbackQuery;

        if (error) {
          request.log.error(
            { error, geoSelection: describeGeoSelection(geoSelection), commercial_offer_type, sort_by },
            "leads derived query error"
          );
          return reply.status(500).send({ error: "Database error", error_code: "db_error" });
        }

        const normalizedRows = (data ?? []).map((row) => normalizeLeadRow(row as JsonRecord));
        const gpsById = geoSelectionActive
          ? await fetchLeadGpsByIds(
              db,
              normalizedRows
                .map((row) => asNullableString(row["id"]))
                .filter((id): id is string => Boolean(id))
            )
          : null;
        const rowsWithGeo = gpsById
          ? normalizedRows.map((row) => ({
              ...row,
              gps: gpsById.get(asNullableString(row["id"]) ?? "") ?? null,
            }))
          : normalizedRows;
        const cmLeadFilter = authUser.role === "cm" ? authUser.lead_filter : null;
        const scopedRows = cmLeadFilter
          ? rowsWithGeo.filter((row) => passesLeadFilter(row, cmLeadFilter))
          : rowsWithGeo;

        const matchingRows: JsonRecord[] = [];
        for (const row of scopedRows) {
          if (!matchesCommercialOfferType(row, commercial_offer_type)) continue;
          if (geoSelectionActive && !(await matchesGeoSelection(row, geoSelection, leadGeocodingService.geocodeAddress))) {
            continue;
          }
          matchingRows.push(row);
        }

        const sortedRows = [...matchingRows].sort((left, right) => compareLeadRows(left, right, sort_by, sort_direction));
        const resolvedCursor = cursor
          ? await resolveLeadCursor(db, cursor, sort_by, sort_direction)
          : null;
        const afterCursorRows = resolvedCursor
          ? sortedRows.filter((row) => isLeadRowAfterCursor(row, resolvedCursor, sort_by, sort_direction))
          : sortedRows;

        let cmTrackedIds: Set<string> | null = null;
        const maxVisible =
          authUser.role === "cm" &&
          typeof authUser.lead_filter?.["max_leads_visible"] === "number" &&
          Number.isFinite(authUser.lead_filter["max_leads_visible"])
            ? Math.max(0, authUser.lead_filter["max_leads_visible"] as number)
            : null;
        const cappedRows = maxVisible === null ? afterCursorRows : afterCursorRows.slice(0, maxVisible);
        const hasMore = cappedRows.length > limit;
        const rawPage = hasMore ? cappedRows.slice(0, limit) : cappedRows;

        if (authUser.role === "cm") {
          cmTrackedIds = await getCmActiveTrackedLeadIds(
            authUser.id,
            rawPage.map((row) => asNullableString(row["id"])).filter((id): id is string => Boolean(id))
          );
        }

        const page = cmTrackedIds
          ? rawPage.map((row) => (cmTrackedIds?.has(asNullableString(row["id"]) ?? "") ? row : redactContactFields(row)))
          : rawPage;
        const lastRow = rawPage[rawPage.length - 1];
        const lastSummary = lastRow ? getLeadCommercialSummary(lastRow) : null;
        const nextCursor =
          hasMore && lastRow
            ? encodeLeadCursor({
                sort_by,
                sort_direction,
                id: asNullableString(lastRow["id"]) ?? "",
                created_at: asNullableString(lastRow["created_at"]) ?? new Date(0).toISOString(),
                prospect_score: asNullableNumber(lastRow["prospect_score"]),
                marketing_score: lastSummary?.marketing_score ?? null,
                software_score: lastSummary?.software_score ?? null,
                offer_balance: lastSummary ? Math.abs(lastSummary.software_score - lastSummary.marketing_score) : null,
              })
            : null;

        return reply.status(200).send({
          data: page,
          next_cursor: nextCursor,
          total: matchingRows.length,
        });
      }

      const resolvedCursor = cursor
        ? await resolveLeadCursor(db, cursor, sort_by, sort_direction)
        : null;

      if (resolvedCursor) {
        if (
          !/^[0-9a-f-]{36}$/i.test(resolvedCursor.id) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(resolvedCursor.created_at)
        ) {
          return reply.code(400).send({ error: "Invalid cursor" });
        }
        if (sort_by === "prospect_score") {
          const score = resolvedCursor.prospect_score ?? -1;
          const comparator = sort_direction === "asc" ? "gt" : "lt";
          query = query.or(
            [
              `prospect_score.${comparator}.${score}`,
              `and(prospect_score.eq.${score},created_at.lt.${resolvedCursor.created_at})`,
              `and(prospect_score.eq.${score},created_at.eq.${resolvedCursor.created_at},id.lt.${resolvedCursor.id})`,
            ].join(",")
          );
        } else {
          query = query.or(
            [
              `created_at.${sort_direction === "asc" ? "gt" : "lt"}.${resolvedCursor.created_at}`,
              `and(created_at.eq.${resolvedCursor.created_at},id.${sort_direction === "asc" ? "gt" : "lt"}.${resolvedCursor.id})`,
            ].join(",")
          );
        }
      }

      if (sort_by === "prospect_score") {
        query = query
          .order("prospect_score", { ascending: sort_direction === "asc", nullsFirst: false })
          .order("created_at", { ascending: sort_direction === "asc" })
          .order("id", { ascending: sort_direction === "asc" });
      } else {
        query = query
          .order("created_at", { ascending: sort_direction === "asc" })
          .order("id", { ascending: sort_direction === "asc" });
      }

      query = query.limit(limit + 1);

      const { data, error, count } = await query;

      if (error) {
        request.log.error({ error }, "leads query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      const rows = (data ?? []).map((row) => normalizeLeadRow(row as JsonRecord));
      const cmLeadFilter = authUser.role === "cm" ? authUser.lead_filter : null;
      const filteredRows = cmLeadFilter
        ? rows.filter((row) => passesLeadFilter(row, cmLeadFilter))
        : rows;

      // RBAC-1: redact contact fields for cm users who haven't started tracking.
      let cmTrackedIds: Set<string> | null = null;
      const maxVisible =
        authUser.role === "cm" &&
        typeof authUser.lead_filter?.["max_leads_visible"] === "number" &&
        Number.isFinite(authUser.lead_filter["max_leads_visible"])
          ? Math.max(0, authUser.lead_filter["max_leads_visible"] as number)
          : null;
      const cappedRows = maxVisible === null ? filteredRows : filteredRows.slice(0, maxVisible);
      const hasMore = cappedRows.length > limit;
      const rawPage = hasMore ? cappedRows.slice(0, limit) : cappedRows;
      if (authUser.role === "cm") {
        cmTrackedIds = await getCmActiveTrackedLeadIds(
          authUser.id,
          rawPage.map((row) => asNullableString(row["id"])).filter((id): id is string => Boolean(id))
        );
      }
      const trackedForPage = cmTrackedIds;
      const page = trackedForPage
        ? rawPage.map((row) =>
            trackedForPage.has(asNullableString(row["id"]) ?? "") ? row : redactContactFields(row)
          )
        : rawPage;
      const lastRow = rawPage[rawPage.length - 1] as JsonRecord | undefined;
      const nextCursor =
        hasMore && lastRow
          ? encodeLeadCursor({
              sort_by,
              sort_direction,
              id: asNullableString(lastRow["id"]) ?? "",
              created_at: asNullableString(lastRow["created_at"]) ?? new Date(0).toISOString(),
              prospect_score: asNullableNumber(lastRow["prospect_score"]),
              marketing_score: null,
              software_score: null,
              offer_balance: null,
            })
          : null;

      return reply.status(200).send({
        data: page,
        next_cursor: nextCursor,
        total: maxVisible === null ? count ?? page.length : cappedRows.length,
      });
    }
  );

  app.post(
    "/admin/enrichment/filter-jobs/estimate",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const estimateSchema = enrichCollectionSchema.omit({ with_heuristic: true, concurrency: true });
      const parseResult = estimateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: "Validation error", details: parseResult.error.flatten().fieldErrors });
      }
      const { contact_tier, prospect_score_gte, niche, source, primary_offer, q,
        missing_gps, missing_address, missing_phone, missing_whatsapp, missing_email, missing_website } = parseResult.data;
      const nicheExpanded = niche !== undefined ? await expandNiche(niche) : undefined;
      const filters: EnrichmentLeadFilterSelection = {
        ...(contact_tier !== undefined && { contact_tier }),
        ...(prospect_score_gte !== undefined && { prospect_score_gte }),
        ...(niche !== undefined && { niche }),
        ...(nicheExpanded !== undefined && nicheExpanded.length > 1 && { niche_expanded: nicheExpanded }),
        ...(source !== undefined && { source }),
        ...(primary_offer !== undefined && { primary_offer }),
        ...(q !== undefined && { q }),
        ...(missing_gps && { missing_gps }),
        ...(missing_address && { missing_address }),
        ...(missing_phone && { missing_phone }),
        ...(missing_whatsapp && { missing_whatsapp }),
        ...(missing_email && { missing_email }),
        ...(missing_website && { missing_website }),
      };
      if (!hasRelevantEnrichmentFilter(filters)) {
        return reply.status(400).send({ error: "At least one filter is required", error_code: "filters_required" });
      }
      const lead_count = await countLeadsByFilterSelection(filters);
      return reply.status(200).send({ data: { lead_count } });
    }
  );

  app.post(
    "/admin/enrichment/filter-jobs",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const parseResult = enrichCollectionSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const {
        contact_tier, prospect_score_gte, niche, source, primary_offer, q,
        missing_gps, missing_address, missing_phone, missing_whatsapp, missing_email, missing_website,
        mode, with_heuristic, concurrency,
      } = parseResult.data;
      const nicheExpanded = niche !== undefined ? await expandNiche(niche) : undefined;
      const filters: EnrichmentLeadFilterSelection = {
        ...(contact_tier !== undefined && { contact_tier }),
        ...(prospect_score_gte !== undefined && { prospect_score_gte }),
        ...(niche !== undefined && { niche }),
        ...(nicheExpanded !== undefined && nicheExpanded.length > 1 && { niche_expanded: nicheExpanded }),
        ...(source !== undefined && { source }),
        ...(primary_offer !== undefined && { primary_offer }),
        ...(q !== undefined && { q }),
        ...(missing_gps && { missing_gps }),
        ...(missing_address && { missing_address }),
        ...(missing_phone && { missing_phone }),
        ...(missing_whatsapp && { missing_whatsapp }),
        ...(missing_email && { missing_email }),
        ...(missing_website && { missing_website }),
      };

      if (!hasRelevantEnrichmentFilter(filters)) {
        return reply.status(400).send({
          error: "At least one approved filter is required",
          error_code: "filters_required",
        });
      }

      const leadCount = await countLeadsByFilterSelection(filters);
      if (leadCount === 0) {
        return reply.status(400).send({
          error: "No leads match the selected filters",
          error_code: "empty_collection",
        });
      }

      if (leadCount > FILTER_ENRICH_LIMIT) {
        return reply.status(400).send({
          error: `Filtered collection exceeds ${FILTER_ENRICH_LIMIT} leads`,
          error_code: "lead_limit_exceeded",
          details: { lead_count: leadCount, limit: FILTER_ENRICH_LIMIT },
        });
      }

      if (mode === "re_discovery") {
        const job = await startReDiscoveryJob({ filters, concurrency });
        return reply.status(202).send({
          data: { run_id: job.runId, lead_count: leadCount, filters, mode, concurrency },
        });
      }

      const job = await startFilterEnrichmentJob({
        filters,
        withHeuristic: with_heuristic,
        concurrency,
      });

      return reply.status(202).send({
        data: {
          run_id: job.runId,
          lead_count: leadCount,
          filters,
          mode,
          with_heuristic,
          concurrency,
        },
      });
    }
  );

  app.get(
    "/leads/:id/feedback",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const parseResult = leadFeedbackListQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid query",
          error_code: "invalid_query",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const includeRejected = authUser.role === "admin" && parseResult.data.include_rejected === "true";
      const lead = await loadAccessibleLeadForFeedback(authUser, id, includeRejected);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      let query = getDb()
        .from("lead_feedback")
        .select("*", { count: "exact" })
        .eq("lead_id", id);

      if (parseResult.data.field_key) {
        query = query.eq("field_key", parseResult.data.field_key);
      }

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .limit(parseResult.data.limit);
      if (error) {
        request.log.error({ error, leadId: id }, "lead feedback query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({ data: data ?? [], total: count ?? 0, lead_id: lead["id"] });
    }
  );

  // Histórico social: serie de seguidores + métricas derivadas (crecimiento, posts/mes, churn)
  // por plataforma. Devuelve serie vacía si todavía no hay capturas acumuladas.
  app.get(
    "/leads/:id/social-history",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
      const lead = await loadAccessibleLeadForFeedback(authUser, id, false);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      try {
        const byPlatform = await loadSocialSnapshots(id);
        const nowIso = new Date().toISOString();
        const platforms: Record<string, unknown> = {};
        for (const [platform, snapshots] of Object.entries(byPlatform)) {
          platforms[platform] = deriveSocialMetrics(snapshots, { nowIso });
        }
        return reply.status(200).send({ data: { lead_id: id, platforms }, meta: { platform_count: Object.keys(platforms).length } });
      } catch (err) {
        request.log.error({ err, leadId: id }, "social-history query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }
    }
  );

  app.get(
    "/leads/:id/feedback-summary",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const parseResult = leadFeedbackSummaryQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid query",
          error_code: "invalid_query",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const includeRejected = authUser.role === "admin" && parseResult.data.include_rejected === "true";
      const lead = await loadAccessibleLeadForFeedback(authUser, id, includeRejected);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const { data, error } = await getDb()
        .from("lead_feedback")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) {
        request.log.error({ error, leadId: id }, "lead feedback summary query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({
        data: summarizeFeedbackRows((data ?? []) as Array<Record<string, unknown>>),
        lead_id: lead["id"],
      });
    }
  );

  // GET /api/v1/leads/:id/feedback-adjusted-confidence
  app.get(
    "/leads/:id/feedback-adjusted-confidence",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const includeRejected = authUser.role === "admin" && (request.query as { include_rejected?: string }).include_rejected === "true";
      const lead = await loadAccessibleLeadForFeedback(authUser, id, includeRejected);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const { data, error } = await getDb()
        .from("lead_feedback")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) {
        request.log.error({ error, leadId: id }, "lead feedback adjusted confidence query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      const summary = summarizeFeedbackRows((data ?? []) as Array<Record<string, unknown>>);
      const adjusted = computeFeedbackAdjustedConfidence({
        contactReliabilityScore: asNullableNumber(lead["contact_reliability_score"]),
        dataConfidenceScore: asNullableNumber(lead["data_confidence_score"]),
        summary,
      });

      return reply.status(200).send({ data: adjusted, lead_id: lead["id"] });
    }
  );

  app.post(
    "/leads/:id/feedback",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const parseResult = leadFeedbackCreateSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const includeRejected = authUser.role === "admin" && (request.query as { include_rejected?: string }).include_rejected === "true";
      const lead = await loadAccessibleLeadForFeedback(authUser, id, includeRejected);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      // Reasignación: solo válida marcando "bad" + "no pertenece al lead", a un lead distinto que exista.
      const reassignTo = parseResult.data.reassign_to_lead_id;
      if (reassignTo) {
        if (parseResult.data.verdict !== "bad" || parseResult.data.rejection_reason !== "no_pertenece_al_lead") {
          return reply.status(400).send({ error: "Reassign requires verdict=bad and reason=no_pertenece_al_lead", error_code: "invalid_reassign" });
        }
        if (reassignTo === id) {
          return reply.status(400).send({ error: "Cannot reassign to the same lead", error_code: "invalid_reassign_target" });
        }
        // Validar el destino respetando el RBAC del usuario (un CM no puede reasignar a
        // leads fuera de su lead_filter — evita inferir existencia / apuntar fuera de scope).
        const target = await loadAccessibleLeadForFeedback(authUser, reassignTo, false);
        if (!target) {
          return reply.status(400).send({ error: "Reassign target lead not found", error_code: "reassign_target_not_found" });
        }
      }

      const payload = {
        lead_id: id,
        field_key: parseResult.data.field_key,
        field_value: parseResult.data.field_value ?? null,
        verdict: parseResult.data.verdict,
        comment: parseResult.data.comment ?? null,
        rejection_reason: parseResult.data.rejection_reason ?? null,
        reassign_to_lead_id: reassignTo ?? null,
        actor_user_id: authUser.id,
        actor_role: authUser.role,
      };

      const { data, error } = await getDb().from("lead_feedback").insert(payload).select("*").single();
      if (error || !data) {
        request.log.error({ error, leadId: id }, "lead feedback insert error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      await writeLeadFeedbackAuditLog(request, id, String((data as Record<string, unknown>)["id"]), {
        field_key: parseResult.data.field_key,
        verdict: parseResult.data.verdict,
        comment: parseResult.data.comment ?? null,
        field_value: parseResult.data.field_value,
      });

      return reply.status(201).send({ data, lead_id: lead["id"] });
    }
  );

  // Reemplazo total del array de contactos favoritos (idempotente por naturaleza).
  app.patch(
    "/leads/:id/favorite-contacts",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (!permissiveUuid.safeParse(id).success) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
      const parsed = favoriteContactsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation error", error_code: "validation_error", details: parsed.error.flatten().fieldErrors });
      }
      const lead = await loadAccessibleLeadForFeedback(authUser, id, false);
      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
      // Un CM solo puede marcar favoritos en leads que está trabajando (con tracking activo),
      // coherente con la redacción de contactos del detalle (no marca valores que no ve).
      if (authUser.role === "cm") {
        const { data: trackingRow } = await getDb()
          .from("lead_tracking")
          .select("id")
          .eq("lead_id", id)
          .eq("owner_id", authUser.id)
          .in("status", [...ACTIVE_TRACKING_STATUSES])
          .limit(1)
          .maybeSingle();
        if (!trackingRow) {
          return reply.status(403).send({ error: "Lead sin seguimiento activo", error_code: "tracking_required" });
        }
      }
      const markedAt = new Date().toISOString();
      const favorites = parsed.data.favorite_contacts.map((c) => ({
        kind: c.kind,
        value: c.value,
        marked_by: authUser.email ?? authUser.id,
        marked_at: markedAt,
      }));
      const { error } = await getDb().from("leads").update({ favorite_contacts: favorites }).eq("id", id);
      if (error) {
        request.log.error({ error, leadId: id }, "favorite-contacts update error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }
      return reply.status(200).send({ data: { lead_id: id, favorite_contacts: favorites } });
    }
  );

  app.get(
    "/leads/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
      ) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const db = getDb();

      // Admin: can access rejected leads with ?include_rejected=true
      const { include_rejected } = request.query as { include_rejected?: string };
      const adminIncludeRejected =
        authUser.role === "admin" && include_rejected === "true";

      let lead: Record<string, unknown> | null = null;

      if (adminIncludeRejected) {
        // Query directly from leads table (bypasses VIEW's passed_filter=true)
        const { data, error } = await db
          .from("leads")
          .select("*")
          .eq("id", id)
          .single();
        if (!error && data) lead = data as Record<string, unknown>;
      } else {
        const { data, error } = await db
          .from("lead_dashboard")
          .select("*")
          .eq("id", id)
          .single();
        if (!error && data) lead = data as Record<string, unknown>;
      }

      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(lead as JsonRecord);

      // CM filter check — 404 (not 403) to not reveal existence
      if (authUser.role === "cm") {
        if (!authUser.lead_filter) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
        if (!passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
        // RBAC-1: redact contact fields unless the cm user has started tracking this lead
        const db2 = getDb();
        const { data: trackingRow } = await db2
          .from("lead_tracking")
          .select("id")
          .eq("lead_id", id)
          .eq("owner_id", authUser.id)
          .in("status", [...ACTIVE_TRACKING_STATUSES])
          .limit(1)
          .maybeSingle();
        if (!trackingRow) {
          return reply.status(200).send({ data: redactContactFields(normalizedLead) });
        }
      }

      // favorite_contacts vive en la tabla leads (no en lead_dashboard): se adjunta aparte,
      // solo para leads accesibles (después del gate de RBAC).
      if (normalizedLead["favorite_contacts"] === undefined) {
        const { data: favRow } = await db.from("leads").select("favorite_contacts").eq("id", id).maybeSingle();
        normalizedLead["favorite_contacts"] = (favRow as { favorite_contacts?: unknown } | null)?.favorite_contacts ?? [];
      }

      return reply.status(200).send({ data: normalizedLead });
    }
  );

  // GET /api/v1/leads/:id/owner-group — list sibling leads sharing the same owner
  app.get(
    "/leads/:id/owner-group",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const db = getDb();

      const { data: lead, error: leadErr } = await db
        .from("lead_dashboard")
        .select("*")
        .eq("id", id)
        .single();

      if (leadErr || !lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(lead as JsonRecord);

      if (authUser.role === "cm") {
        if (!authUser.lead_filter || !passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      const groupId = normalizedLead["owner_group_id"];
      if (!groupId) {
        return reply.status(200).send({ data: [] });
      }

      const { data: siblings, error: siblingsErr } = await db
        .from("lead_dashboard")
        .select("*")
        .eq("owner_group_id", groupId)
        .neq("id", id);

      if (siblingsErr) {
        request.log.error({ error: siblingsErr }, "owner-group query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      let results = siblings ?? [];

      if (authUser.role === "cm" && authUser.lead_filter) {
        results = results.filter((s) =>
          passesLeadFilter(
            normalizeLeadRow(s as JsonRecord),
            authUser.lead_filter as Record<string, unknown>
          )
        );
      }

      const normalizedResults = results.map((row) => normalizeLeadRow(row as JsonRecord));

      if (authUser.role === "cm") {
        const siblingIds = normalizedResults.map((r) => r["id"] as string).filter(Boolean);
        const trackedSiblingIds = await getCmActiveTrackedLeadIds(authUser.id, siblingIds);
        return reply.status(200).send({
          data: normalizedResults.map((r) =>
            trackedSiblingIds.has(r["id"] as string) ? r : redactContactFields(r)
          ),
        });
      }

      return reply.status(200).send({
        data: normalizedResults,
      });
    }
  );

  app.post(
    "/leads/:id/assistant-brief",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const authUser = getAuthUser(request);
      const db = getDb();
      const { data, error } = await db.from("lead_dashboard").select("*").eq("id", id).single();

      if (error || !data) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(data as JsonRecord);

      if (authUser.role === "cm") {
        if (!authUser.lead_filter || !passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
        const trackedIds = await getCmActiveTrackedLeadIds(authUser.id, [id]);
        if (!trackedIds.has(id)) {
          return reply.status(403).send({ error: "Brief not available until tracking is started", error_code: "contact_redacted" });
        }
      }

      const provider = createLLMProvider();
      const startedAt = Date.now();
      let result;
      let success = true;
      let errorMessage: string | null = null;

      try {
        result = await provider.generateLeadBrief({
          lead_id: id,
          lead_name: (normalizedLead["name"] as string) ?? "",
          niche: (normalizedLead["niche"] as string | null) ?? null,
          contact_tier: (normalizedLead["contact_tier"] as string | null) ?? null,
          prospect_score: (normalizedLead["prospect_score"] as number | null) ?? null,
          urgency_signal: (normalizedLead["urgency_signal"] as string | null) ?? null,
          primary_offer: (normalizedLead["primary_offer"] as string | null) ?? null,
          pitch_hook: (normalizedLead["pitch_hook"] as string | null) ?? null,
          state: (normalizedLead["state"] as string | null) ?? null,
          contact_ready: (normalizedLead["contact_ready"] as boolean | null) ?? null,
          top_buyer_type: (normalizedLead["top_buyer_type"] as string | null) ?? null,
          business_status: (normalizedLead["business_status"] as string | null) ?? null,
          phone: (normalizedLead["phone"] as string | null) ?? null,
          whatsapp: (normalizedLead["whatsapp"] as string | null) ?? null,
          email: (normalizedLead["email"] as string | null) ?? null,
          website: (normalizedLead["website"] as string | null) ?? null,
          contact_reliability_score: (normalizedLead["contact_reliability_score"] as number | null) ?? null,
          source_confidence: (normalizedLead["source_confidence"] as number | null) ?? null,
        });
      } catch (err) {
        const primaryError = err instanceof Error ? err.message : String(err);
        errorMessage = primaryError;
        request.log.error({ err }, "LLM lead brief error");
        try {
          const templateModule = await import("../llm/template.js");
          const templateProvider = new templateModule.TemplateProvider();
          result = await templateProvider.generateLeadBrief({
            lead_id: id,
            lead_name: (normalizedLead["name"] as string) ?? "",
            niche: (normalizedLead["niche"] as string | null) ?? null,
            contact_tier: (normalizedLead["contact_tier"] as string | null) ?? null,
            prospect_score: (normalizedLead["prospect_score"] as number | null) ?? null,
            urgency_signal: (normalizedLead["urgency_signal"] as string | null) ?? null,
            primary_offer: (normalizedLead["primary_offer"] as string | null) ?? null,
            pitch_hook: (normalizedLead["pitch_hook"] as string | null) ?? null,
            state: (normalizedLead["state"] as string | null) ?? null,
            contact_ready: (normalizedLead["contact_ready"] as boolean | null) ?? null,
            top_buyer_type: (normalizedLead["top_buyer_type"] as string | null) ?? null,
            business_status: (normalizedLead["business_status"] as string | null) ?? null,
            phone: (normalizedLead["phone"] as string | null) ?? null,
            whatsapp: (normalizedLead["whatsapp"] as string | null) ?? null,
            email: (normalizedLead["email"] as string | null) ?? null,
            website: (normalizedLead["website"] as string | null) ?? null,
            contact_reliability_score: (normalizedLead["contact_reliability_score"] as number | null) ?? null,
            source_confidence: (normalizedLead["source_confidence"] as number | null) ?? null,
          });
          errorMessage = `fallback:${primaryError}`;
        } catch (fallbackErr) {
          success = false;
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          errorMessage = `primary:${primaryError}; fallback:${fallbackMessage}`;
          request.log.error({ fallbackErr }, "Template lead brief fallback error");
          void Promise.resolve(
            db.from("llm_usage_log").insert({
              provider: provider.name,
              model: provider.model,
              operation: "lead_brief",
              lead_id: id,
              user_id: authUser.id,
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              cost_usd: 0,
              duration_ms: Date.now() - startedAt,
              success,
              error: errorMessage,
            })
          )
            .then(({ error: logErr }) => {
              if (logErr) request.log.warn({ logErr }, "llm_usage_log insert failed");
            })
            .catch((err: unknown) => request.log.warn({ err }, "audit log insert threw"));
          return reply.status(502).send({
            error: "Assistant brief unavailable",
            error_code: "assistant_unavailable",
          });
        }
      }

      void Promise.resolve(
        db.from("llm_usage_log").insert({
          provider: result.provider ?? provider.name,
          model: result.model ?? provider.model,
          operation: "lead_brief",
          lead_id: id,
          user_id: authUser.id,
          prompt_tokens: result.tokens_in ?? 0,
          completion_tokens: result.tokens_out ?? 0,
          total_tokens: (result.tokens_in ?? 0) + (result.tokens_out ?? 0),
          cost_usd: result.cost_usd_estimated ?? 0,
          duration_ms: Date.now() - startedAt,
          success,
          error: errorMessage,
        })
      )
        .then(({ error: logErr }) => {
          if (logErr) request.log.warn({ logErr }, "llm_usage_log insert failed");
        })
        .catch((err: unknown) => request.log.warn({ err }, "audit log insert threw"));

      return reply.status(200).send({ data: result });
    }
  );
}

function passesLeadFilter(
  lead: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  const tierFilter = filter["contact_tier"];
  if (Array.isArray(tierFilter) && tierFilter.length > 0) {
    const leadTier = lead["contact_tier"] as string | undefined;
    if (!leadTier || !tierFilter.includes(leadTier)) return false;
  }

  const primaryOffer = filter["primary_offer"];
  if (typeof primaryOffer === "string" && primaryOffer) {
    if (lead["primary_offer"] !== primaryOffer) return false;
  } else if (Array.isArray(primaryOffer) && primaryOffer.length > 0) {
    const leadOffer = lead["primary_offer"] as string | undefined;
    if (!leadOffer || !primaryOffer.includes(leadOffer)) return false;
  }

  const nicheFilter = filter["niche"];
  if (Array.isArray(nicheFilter) && nicheFilter.length > 0) {
    const leadNiche = lead["niche"] as string | undefined;
    if (!leadNiche || !nicheFilter.includes(leadNiche)) return false;
  }

  const sourceFilter = filter["source"];
  if (Array.isArray(sourceFilter) && sourceFilter.length > 0) {
    const leadSource = lead["source"] as string | undefined;
    if (!leadSource || !sourceFilter.includes(leadSource)) return false;
  }

  if (filter["exclude_contacted"] === true && lead["contacted_at"] != null) {
    return false;
  }

  if (
    filter["exclude_franchises"] === true &&
    Array.isArray(lead["tags"]) &&
    (lead["tags"] as unknown[]).includes("franchise-detected")
  ) {
    return false;
  }

  const requireState = filter["require_inferred_state"];
  if (isRecord(requireState)) {
    const inferredState = isRecord(lead["inferred_state"]) ? lead["inferred_state"] : null;
    const boolChecks = [
      "has_delivery",
      "has_pos",
      "has_reservations",
    ] as const;
    for (const key of boolChecks) {
      if (requireState[key] === true) {
        const fieldValue = inferredState && isRecord(inferredState[key])
          ? inferredState[key]["value"]
          : null;
        if (fieldValue !== true) return false;
      }
    }
  }

  const detectedSubNiche = filter["detected_sub_niche"];
  if (Array.isArray(detectedSubNiche) && detectedSubNiche.length > 0) {
    const companyData = isRecord(lead["lead_company_data"]) ? lead["lead_company_data"] : null;
    const leadSubNiche = companyData ? asNullableString(companyData["detected_sub_niche"]) : null;
    if (!leadSubNiche || !detectedSubNiche.includes(leadSubNiche)) return false;
  }

  return true;
}
