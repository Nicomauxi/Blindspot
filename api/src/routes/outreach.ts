import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";

// Permissive UUID regex (Zod v4 uuid() is RFC-strict; this matches any 8-4-4-4-12 hex)
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const OUTREACH_STATUSES = [
  "contacted",
  "responded",
  "interested",
  "closed_won",
  "closed_lost",
  "no_response",
] as const;

const OUTCOMES = ["closed_won", "closed_lost", "not_now", "has_provider"] as const;
const LOST_REASONS = ["price", "timing", "no_interest", "competitor", "other"] as const;

const createSchema = z.object({
  lead_id: uuidSchema,
  channel: z.string().min(1).max(100),
  offer_type: z.string().max(100).optional(),
  offer_package: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(OUTREACH_STATUSES).default("contacted"),
  responded: z.boolean().optional(),
  outcome: z.enum(OUTCOMES).nullable().optional(),
  lost_reason: z.enum(LOST_REASONS).nullable().optional(),
  service_sold: z.string().max(200).optional(),
  price_sold: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  contacted_at: z.string().datetime().optional(),
  responded_at: z.string().datetime().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
  lead_quality_signal: z.number().int().min(-10).max(10).default(0),
});

const patchSchema = createSchema
  .omit({ lead_id: true })
  .partial()
  .extend({
    lead_quality_signal: z.number().int().min(-10).max(10).optional(),
  });

const listQuerySchema = z.object({
  lead_id: uuidSchema.optional(),
  status: z.enum(OUTREACH_STATUSES).optional(),
  cursor: uuidSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

function validateStatusOutcome(
  status: string,
  outcome?: string | null,
  lost_reason?: string | null
): string | null {
  if (status === "closed_won") {
    if (outcome && outcome !== "closed_won") {
      return "outreach_status_outcome_mismatch";
    }
  } else if (status === "closed_lost") {
    if (outcome && outcome !== "closed_lost") {
      return "outreach_status_outcome_mismatch";
    }
  } else {
    // Non-closed statuses
    if (outcome === "closed_won" || outcome === "closed_lost") {
      return "outreach_status_outcome_mismatch";
    }
    if (lost_reason) {
      return "outreach_status_outcome_mismatch";
    }
  }
  return null;
}

export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/outreach — list outreach records
  app.get("/outreach", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = listQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { lead_id, status, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("lead_outreach")
      .select("*", { count: "exact" });

    // CM can only see their own records
    if (authUser.role === "cm") {
      query = query.eq("user_id", authUser.id);
    }

    if (lead_id) query = query.eq("lead_id", lead_id);
    if (status) query = query.eq("status", status);

    if (cursor) {
      const { data: cursorRow } = await db
        .from("lead_outreach")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    query = query.order("created_at", { ascending: false }).limit(limit + 1);

    const { data, error, count } = await query;
    if (error) {
      request.log.error({ error }, "outreach list query error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null : null;

    return reply.status(200).send({
      data: page,
      next_cursor: nextCursor,
      total: count ?? 0,
    });
  });

  // POST /api/v1/outreach — create outreach record
  app.post("/outreach", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = createSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const body = parseResult.data;

    const statusOutcomeError = validateStatusOutcome(
      body.status,
      body.outcome ?? null,
      body.lost_reason ?? null
    );
    if (statusOutcomeError) {
      return reply.status(400).send({
        error: "Status and outcome are inconsistent",
        error_code: statusOutcomeError,
      });
    }

    // Verify the lead exists and CM can access it
    const db = getDb();
    const { data: lead, error: leadError } = await db
      .from("lead_dashboard")
      .select("id, contact_tier")
      .eq("id", body.lead_id)
      .single();

    if (leadError || !lead) {
      return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
    }

    // CM filter check
    if (authUser.role === "cm") {
      if (!authUser.lead_filter) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
      const tierFilter = authUser.lead_filter["contact_tier"];
      if (
        Array.isArray(tierFilter) &&
        tierFilter.length > 0 &&
        !(lead as { contact_tier: string }).contact_tier
          ? false
          : Array.isArray(tierFilter) &&
            tierFilter.length > 0 &&
            !tierFilter.includes((lead as { contact_tier: string }).contact_tier)
      ) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
    }

    const { data: row, error: insertError } = await db
      .from("lead_outreach")
      .insert({
        lead_id: body.lead_id,
        user_id: authUser.id,
        channel: body.channel,
        offer_type: body.offer_type ?? null,
        offer_package: body.offer_package ?? null,
        status: body.status,
        responded: body.responded ?? null,
        outcome: body.outcome ?? null,
        lost_reason: body.lost_reason ?? null,
        service_sold: body.service_sold ?? null,
        price_sold: body.price_sold ?? null,
        notes: body.notes ?? null,
        contacted_at: body.contacted_at ?? new Date().toISOString(),
        responded_at: body.responded_at ?? null,
        closed_at: body.closed_at ?? null,
        lead_quality_signal: body.lead_quality_signal,
      })
      .select()
      .single();

    if (insertError) {
      request.log.error({ error: insertError }, "outreach insert error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    // Update leads.contacted_by if this is the first outreach for this lead
    await db
      .from("leads")
      .update({ contacted_by: authUser.id })
      .eq("id", body.lead_id)
      .is("contacted_by", null);

    return reply.status(201).send({ data: row });
  });

  // PATCH /api/v1/outreach/:id — update outreach record
  app.patch(
    "/outreach/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      const parseResult = patchSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const db = getDb();

      // Load existing record
      const { data: existing, error: fetchError } = await db
        .from("lead_outreach")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError || !existing) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      // CM can only update their own records — 404 to not reveal existence
      if (authUser.role === "cm" && (existing as { user_id: string }).user_id !== authUser.id) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      const patch = parseResult.data;
      const mergedStatus = patch.status ?? (existing as { status: string }).status;
      const mergedOutcome =
        "outcome" in patch
          ? (patch.outcome ?? null)
          : (existing as { outcome: string | null }).outcome;
      const mergedLostReason =
        "lost_reason" in patch
          ? (patch.lost_reason ?? null)
          : (existing as { lost_reason: string | null }).lost_reason;

      const statusOutcomeError = validateStatusOutcome(
        mergedStatus,
        mergedOutcome,
        mergedLostReason
      );
      if (statusOutcomeError) {
        return reply.status(400).send({
          error: "Status and outcome are inconsistent",
          error_code: statusOutcomeError,
        });
      }

      // Build update payload (only provided fields)
      const updatePayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) updatePayload[k] = v;
      }

      if (Object.keys(updatePayload).length === 0) {
        return reply.status(400).send({
          error: "No fields to update",
          error_code: "empty_patch",
        });
      }

      const { data: updated, error: updateError } = await db
        .from("lead_outreach")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        request.log.error({ error: updateError }, "outreach patch error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({ data: updated });
    }
  );

  // POST /api/v1/outreach/generate-offer — stub until Fase 26
  app.post(
    "/outreach/generate-offer",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        lead_id?: string;
        offer_type?: string;
        channel?: string;
      };

      if (!body?.lead_id) {
        return reply.status(400).send({
          error: "lead_id is required",
          error_code: "validation_error",
        });
      }

      // Stub: returns a fixed template. Fase 26 replaces this with LLM call.
      return reply.status(200).send({
        data: {
          text: `Hola, somos Blindspot. Notamos que tu negocio podría beneficiarse de una solución digital personalizada.`,
          source_llm: "template",
          generated_at: new Date().toISOString(),
        },
        _stub: true,
        _note: "Fase 26 will replace this with real LLM generation",
      });
    }
  );
}
