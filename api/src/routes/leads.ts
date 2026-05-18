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

function buildLeadFilterConditions(
  leadFilter: Record<string, unknown>
): string[] {
  const conditions: string[] = [];

  const contactTier = leadFilter["contact_tier"];
  if (Array.isArray(contactTier) && contactTier.length > 0) {
    const tiers = contactTier.map((t) => `'${String(t)}'`).join(",");
    conditions.push(`contact_tier = ANY(ARRAY[${tiers}])`);
  }

  const primaryOffer = leadFilter["primary_offer"];
  if (typeof primaryOffer === "string" && primaryOffer) {
    conditions.push(`primary_offer = '${primaryOffer.replace(/'/g, "''")}'`);
  }

  return conditions;
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
        const filterConditions = buildLeadFilterConditions(authUser.lead_filter);
        for (const cond of filterConditions) {
          query = query.filter(cond, "is", null);
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

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      return reply.status(200).send({
        data: page,
        next_cursor: nextCursor,
        total: count ?? 0,
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

      // CM filter check — 404 (not 403) to not reveal existence
      if (authUser.role === "cm") {
        if (!authUser.lead_filter) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
        if (!passesLeadFilter(lead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      return reply.status(200).send({ data: lead });
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
        .select("id, owner_group_id, contact_tier")
        .eq("id", id)
        .single();

      if (leadErr || !lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      if (authUser.role === "cm") {
        if (!authUser.lead_filter || !passesLeadFilter(lead as Record<string, unknown>, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      const groupId = (lead as Record<string, unknown>)["owner_group_id"];
      if (!groupId) {
        return reply.status(200).send({ data: [] });
      }

      const { data: siblings, error: siblingsErr } = await db
        .from("lead_dashboard")
        .select("id, name, niche, contact_tier, prospect_score, owner_group_id")
        .eq("owner_group_id", groupId)
        .neq("id", id);

      if (siblingsErr) {
        request.log.error({ error: siblingsErr }, "owner-group query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      let results = siblings ?? [];

      if (authUser.role === "cm" && authUser.lead_filter) {
        results = results.filter((s) =>
          passesLeadFilter(s as Record<string, unknown>, authUser.lead_filter as Record<string, unknown>)
        );
      }

      return reply.status(200).send({ data: results });
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
  }

  return true;
}
