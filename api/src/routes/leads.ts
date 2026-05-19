import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const CONTACT_TIERS = ["A", "B", "C", "D", "X"] as const;
type ContactTier = (typeof CONTACT_TIERS)[number];

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
  q: z.string().optional(),
  cursor: permissiveUuid.optional(),
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

function normalizeLeadRow(row: JsonRecord): JsonRecord {
  const canonicalFields = isRecord(row["canonical_fields"]) ? row["canonical_fields"] : null;
  const corroboratingSources = asCorroboratingSources(row["corroborating_sources"]);

  return {
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
    search_vector: row["search_vector"] ?? null,
    sources_count: asNullableNumber(row["sources_count"]) ?? corroboratingSources.length,
  };
}

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
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

      const { contact_tier, prospect_score_gte, niche, source, q, cursor, limit } =
        parseResult.data;

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
      if (q) {
        query = query.textSearch("search_vector", q, { type: "plain", config: "spanish" });
      }

      // Cursor-based pagination using id ordering
      if (cursor) {
        // Get the created_at of the cursor lead for stable keyset pagination
        const { data: cursorLead } = await db
          .from("lead_dashboard")
          .select("created_at")
          .eq("id", cursor)
          .single();
        if (cursorLead) {
          query = query.lt("created_at", cursorLead.created_at);
        }
      }

      query = query.order("created_at", { ascending: false }).limit(limit + 1);

      const { data, error, count } = await query;

      if (error) {
        request.log.error({ error }, "leads query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      const rows = (data ?? []).map((row) => normalizeLeadRow(row as JsonRecord));
      const filteredRows =
        authUser.role === "cm" && authUser.lead_filter
          ? rows.filter((row) => passesLeadFilter(row, authUser.lead_filter))
          : rows;
      const maxVisible =
        authUser.role === "cm" &&
        typeof authUser.lead_filter?.["max_leads_visible"] === "number" &&
        Number.isFinite(authUser.lead_filter["max_leads_visible"])
          ? Math.max(0, authUser.lead_filter["max_leads_visible"] as number)
          : null;
      const cappedRows = maxVisible === null ? filteredRows : filteredRows.slice(0, maxVisible);
      const hasMore = cappedRows.length > limit;
      const page = hasMore ? cappedRows.slice(0, limit) : cappedRows;
      const nextCursor = hasMore ? ((page[page.length - 1]?.id as string | undefined) ?? null) : null;

      return reply.status(200).send({
        data: page,
        next_cursor: nextCursor,
        total: maxVisible === null ? count ?? page.length : Math.min(count ?? page.length, maxVisible),
      });
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

      return reply.status(200).send({
        data: results.map((row) => normalizeLeadRow(row as JsonRecord)),
      });
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
