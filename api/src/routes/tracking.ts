import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID");

const CRM_STATUSES = ["pending", "validation", "contact", "observed", "rejected", "accepted"] as const;
type CrmStatus = (typeof CRM_STATUSES)[number];

const VALID_TRANSITIONS: Record<CrmStatus, ReadonlyArray<CrmStatus>> = {
  pending:    ["validation", "rejected"],
  validation: ["contact", "rejected"],
  contact:    ["observed", "accepted", "rejected"],
  observed:   ["contact", "accepted", "rejected"],
  rejected:   ["validation"],
  accepted:   ["validation"],
};

const createTrackingSchema = z.object({
  lead_id:     uuidSchema,
  notes:       z.string().trim().max(2000).optional(),
  campaign_id: uuidSchema.optional(),
});

const transitionSchema = z.object({
  to_status:   z.enum(CRM_STATUSES),
  notes:       z.string().trim().max(2000).optional(),
  channel:     z.string().trim().max(80).optional(),
  reminder_at: z.string().datetime().optional(),
});

const listQuerySchema = z.object({
  status:             z.enum(CRM_STATUSES).optional(),
  status_in:          z.string().optional(),
  owner_id:           uuidSchema.optional(),
  lead_id:            uuidSchema.optional(),
  niche:              z.string().max(80).optional(),
  source:             z.string().max(80).optional(),
  contact_tier:       z.string().max(20).optional(),
  prospect_score_gte: z.string().optional()
                      .transform((v) => (v ? parseInt(v, 10) : undefined))
                      .pipe(z.number().int().min(0).max(100).optional()),
  created_after:      z.string().datetime().optional(),
  q:                  z.string().max(200).optional(),
  limit:              z.string().optional()
                      .transform((v) => Math.min(Number(v ?? "200"), 500))
                      .pipe(z.number().int().min(1).max(500)),
});

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/tracking — create a new CRM tracking entry
  app.post("/tracking", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);

    const parsed = createTrackingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const db = getDb();

    // Verify lead is accessible
    const { data: lead, error: leadErr } = await db
      .from("lead_dashboard")
      .select("id, contact_tier")
      .eq("id", parsed.data.lead_id)
      .single();

    if (leadErr || !lead) {
      return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
    }

    // CM: only for leads that pass their filter
    if (authUser.role === "cm" && authUser.lead_filter) {
      const tier = (lead as Record<string, unknown>)["contact_tier"];
      const allowedTiers = authUser.lead_filter["contact_tier"] as string[] | undefined;
      if (allowedTiers && tier && !allowedTiers.includes(String(tier))) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
    }

    const { data: tracking, error: insertErr } = await db
      .from("lead_tracking")
      .insert({
        lead_id:     parsed.data.lead_id,
        owner_id:    authUser.id,
        status:      "pending",
        campaign_id: parsed.data.campaign_id ?? null,
        notes:       parsed.data.notes ?? null,
      })
      .select("*")
      .single();

    if (insertErr || !tracking) {
      // Unique constraint violation = active tracking already exists
      if ((insertErr as unknown as Record<string, unknown>)?.["code"] === "23505") {
        return reply.status(409).send({
          error: "Active tracking already exists for this lead",
          error_code: "tracking_conflict",
        });
      }
      request.log.error({ error: insertErr }, "tracking create failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const trackingId = (tracking as Record<string, unknown>)["id"] as string;

    const { error: eventErr } = await db.from("lead_tracking_events").insert({
      tracking_id:   trackingId,
      from_status:   null,
      to_status:     "pending",
      actor_user_id: authUser.id,
      actor_role:    authUser.role,
      notes:         parsed.data.notes ?? null,
    });
    if (eventErr) request.log.error({ error: eventErr }, "tracking create event insert failed");

    const { error: auditErr } = await db.from("audit_log").insert({
      actor_user_id: authUser.id,
      actor_role:    authUser.role,
      action:        "tracking.create",
      target_type:   "lead",
      target_id:     parsed.data.lead_id,
      diff:          { tracking_id: trackingId, lead_id: parsed.data.lead_id },
    });
    if (auditErr) request.log.error({ error: auditErr }, "tracking create audit insert failed");

    return reply.status(201).send({ data: tracking });
  });

  // GET /api/v1/tracking — list trackings
  app.get("/tracking", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);

    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const f = parsed.data;

    // Resolve lead-based filters first (niche, source, contact_tier, prospect_score_gte, q)
    let restrictLeadIds: string[] | null = null;
    const hasLeadFilter = f.niche ?? f.source ?? f.contact_tier ?? f.prospect_score_gte ?? f.q;
    if (hasLeadFilter) {
      let leadQ = db.from("lead_dashboard").select("id");
      if (f.niche) leadQ = leadQ.eq("niche", f.niche);
      if (f.source) leadQ = leadQ.eq("source", f.source);
      if (f.contact_tier) leadQ = leadQ.eq("contact_tier", f.contact_tier);
      if (f.prospect_score_gte != null) leadQ = leadQ.gte("prospect_score", f.prospect_score_gte);
      if (f.q) leadQ = leadQ.ilike("name", `%${f.q}%`);
      const { data: matchedLeads, error: leadErr } = await leadQ.limit(1000);
      if (leadErr) {
        request.log.error({ error: leadErr }, "tracking list lead filter failed");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }
      restrictLeadIds = (matchedLeads ?? []).map((l: { id: string }) => l.id);
      if (restrictLeadIds.length === 0) {
        return reply.status(200).send({ data: [], total: 0 });
      }
    }

    let query = db
      .from("lead_tracking")
      .select("*", { count: "exact" })
      .order("started_at", { ascending: false });

    if (authUser.role !== "admin") {
      query = query.eq("owner_id", authUser.id);
    } else if (f.owner_id) {
      query = query.eq("owner_id", f.owner_id);
    }

    if (f.status) query = query.eq("status", f.status);
    if (f.status_in) {
      const statuses = f.status_in.split(",").map((s) => s.trim()).filter((s) => CRM_STATUSES.includes(s as CrmStatus));
      if (statuses.length > 0) query = query.in("status", statuses);
    }
    if (f.lead_id) query = query.eq("lead_id", f.lead_id);
    if (f.created_after) query = query.gte("started_at", f.created_after);
    if (restrictLeadIds) query = query.in("lead_id", restrictLeadIds);

    const { data, error, count } = await query.limit(f.limit);
    if (error) {
      request.log.error({ error }, "tracking list failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const trackings = (data ?? []) as Record<string, unknown>[];
    const leadIds = [...new Set(trackings.map((t) => t["lead_id"] as string))];

    let leadNames: Record<string, string> = {};
    if (leadIds.length > 0) {
      const { data: leads } = await db.from("leads").select("id, name").in("id", leadIds);
      if (leads) {
        leadNames = Object.fromEntries(
          (leads as { id: string; name: string }[]).map((l) => [l.id, l.name])
        );
      }
    }

    const enriched = trackings.map((t) => ({
      ...t,
      lead_name: leadNames[t["lead_id"] as string] ?? null,
    }));

    return reply.status(200).send({ data: enriched, total: count ?? enriched.length });
  });

  // GET /api/v1/tracking/:id — get tracking with events
  app.get("/tracking/:id", {
    preHandler: requireAuth,
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };

    if (!uuidSchema.safeParse(id).success) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const db = getDb();
    const { data: tracking, error } = await db
      .from("lead_tracking")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !tracking) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const t = tracking as Record<string, unknown>;
    if (authUser.role !== "admin" && t["owner_id"] !== authUser.id) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const { data: events, error: eventsErr } = await db
      .from("lead_tracking_events")
      .select("*")
      .eq("tracking_id", id)
      .order("created_at", { ascending: true });

    if (eventsErr) {
      request.log.error({ error: eventsErr }, "tracking events fetch failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const leadId = t["lead_id"] as string;
    const { data: leadRow } = await db
      .from("leads")
      .select("name, niche, address, website, phone")
      .eq("id", leadId)
      .single();

    const lead = leadRow
      ? (leadRow as { name: string; niche: string | null; address: string | null; website: string | null; phone: string | null })
      : null;

    return reply.status(200).send({ data: { ...t, events: events ?? [], lead } });
  });

  // POST /api/v1/tracking/:id/transition — transition CRM state
  app.post("/tracking/:id/transition", {
    preHandler: requireAuth,
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };

    if (!uuidSchema.safeParse(id).success) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const { data: tracking, error: fetchErr } = await db
      .from("lead_tracking")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !tracking) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const t = tracking as Record<string, unknown>;
    if (authUser.role !== "admin" && t["owner_id"] !== authUser.id) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const rawStatus = t["status"];
    if (typeof rawStatus !== "string" || !CRM_STATUSES.includes(rawStatus as CrmStatus)) {
      return reply.status(500).send({ error: "Invalid tracking state", error_code: "db_error" });
    }
    const currentStatus = rawStatus as CrmStatus;
    const toStatus = parsed.data.to_status;

    if (!VALID_TRANSITIONS[currentStatus].includes(toStatus)) {
      return reply.status(422).send({
        error: `Invalid transition: ${currentStatus} → ${toStatus}`,
        error_code: "invalid_transition",
        valid: VALID_TRANSITIONS[currentStatus],
      });
    }

    // Optimistic lock: only update if status is still what we read — prevents concurrent transition races
    const { data: updatedTracking, error: updateErr } = await db
      .from("lead_tracking")
      .update({ status: toStatus })
      .eq("id", id)
      .eq("status", currentStatus)
      .select("*")
      .single();

    if (updateErr) {
      request.log.error({ error: updateErr }, "tracking transition update failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    if (!updatedTracking) {
      return reply.status(409).send({
        error: "Tracking status changed concurrently",
        error_code: "state_conflict",
      });
    }

    const { error: eventErr } = await db.from("lead_tracking_events").insert({
      tracking_id:   id,
      from_status:   currentStatus,
      to_status:     toStatus,
      actor_user_id: authUser.id,
      actor_role:    authUser.role,
      notes:         parsed.data.notes ?? null,
      channel:       parsed.data.channel ?? null,
      reminder_at:   parsed.data.reminder_at ?? null,
    });
    if (eventErr) request.log.error({ error: eventErr }, "tracking transition event insert failed");

    const { error: auditErr } = await db.from("audit_log").insert({
      actor_user_id: authUser.id,
      actor_role:    authUser.role,
      action:        "tracking.transition",
      target_type:   "lead",
      target_id:     String(t["lead_id"]),
      diff:          { tracking_id: id, from_status: currentStatus, to_status: toStatus },
    });
    if (auditErr) request.log.error({ error: auditErr }, "tracking transition audit insert failed");

    return reply.status(200).send({ data: updatedTracking });
  });

  // POST /api/v1/tracking/:id/note — add a standalone note to the tracking timeline
  app.post("/tracking/:id/note", {
    preHandler: requireAuth,
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };

    if (!uuidSchema.safeParse(id).success) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const parsed = z.object({ notes: z.string().trim().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const { data: tracking, error: fetchErr } = await db
      .from("lead_tracking")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !tracking) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const t = tracking as Record<string, unknown>;
    if (authUser.role !== "admin" && t["owner_id"] !== authUser.id) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    const rawNoteStatus = t["status"];
    if (typeof rawNoteStatus !== "string" || !CRM_STATUSES.includes(rawNoteStatus as CrmStatus)) {
      return reply.status(500).send({ error: "Invalid tracking state", error_code: "db_error" });
    }
    const currentStatus = rawNoteStatus as CrmStatus;

    if (currentStatus === "rejected" || currentStatus === "accepted") {
      return reply.status(422).send({
        error: "Cannot add notes to a finalized tracking",
        error_code: "tracking_terminal",
      });
    }

    const { data: event, error: insertErr } = await db
      .from("lead_tracking_events")
      .insert({
        tracking_id:   id,
        from_status:   currentStatus,
        to_status:     currentStatus,
        actor_user_id: authUser.id,
        actor_role:    authUser.role,
        notes:         parsed.data.notes,
      })
      .select("*")
      .single();

    if (insertErr || !event) {
      request.log.error({ error: insertErr }, "tracking note insert failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const { error: auditErr } = await db.from("audit_log").insert({
      actor_user_id: authUser.id,
      actor_role:    authUser.role,
      action:        "tracking.note",
      target_type:   "lead",
      target_id:     String(t["lead_id"]),
      diff:          { tracking_id: id, status: currentStatus },
    });
    if (auditErr) request.log.error({ error: auditErr }, "tracking note audit insert failed");

    return reply.status(201).send({ data: event });
  });
}
