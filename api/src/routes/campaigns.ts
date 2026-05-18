import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID");

const CAMPAIGN_STATUSES = ["active", "paused", "closed"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  segment_filter: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(2000).optional(),
  status: z.enum(CAMPAIGN_STATUSES).default("active"),
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  segment_filter: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
});

export async function campaignsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/campaigns — list campaigns (admin sees all, cm sees own)
  app.get("/campaigns", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const db = getDb();

    let query = db
      .from("outreach_campaigns")
      .select("id, name, user_id, segment_filter, status, notes, created_at, closed_at")
      .order("created_at", { ascending: false });

    if (authUser.role !== "admin") {
      query = query.eq("user_id", authUser.id);
    }

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "campaigns list failed");
      return reply.status(500).send({ error: "Database error" });
    }

    return reply.status(200).send({ data: data ?? [] });
  });

  // POST /api/v1/campaigns — create campaign
  app.post("/campaigns", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.issues });
    }

    const db = getDb();
    const { data, error } = await db
      .from("outreach_campaigns")
      .insert({
        name: parsed.data.name,
        user_id: authUser.id,
        segment_filter: parsed.data.segment_filter,
        notes: parsed.data.notes ?? null,
        status: parsed.data.status,
      })
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "campaign create failed");
      return reply.status(500).send({ error: "Database error" });
    }

    return reply.status(201).send({ data });
  });

  // GET /api/v1/campaigns/:id — get campaign + stats
  app.get("/campaigns/:id", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (!uuidSchema.safeParse(id).success) {
      return reply.status(400).send({ error: "Invalid campaign id" });
    }

    const db = getDb();
    const { data: campaign, error } = await db
      .from("outreach_campaigns")
      .select("id, name, user_id, segment_filter, status, notes, created_at, closed_at")
      .eq("id", id)
      .single();

    if (error || !campaign) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    if (authUser.role !== "admin" && (campaign as Record<string, unknown>)["user_id"] !== authUser.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Compute stats from lead_outreach
    const { data: stats, error: statsErr } = await db
      .from("lead_outreach")
      .select("status, outcome, prospect_score_at_contact")
      .eq("campaign_id", id);

    if (statsErr) {
      request.log.warn({ statsErr }, "campaign stats query failed");
    }

    const rows = stats ?? [];
    const contacted = rows.length;
    const responded = rows.filter((r) => r.status !== "contacted" && r.status !== "no_response").length;
    const closedWon = rows.filter((r) => r.outcome === "closed_won").length;
    const scoresAtContact = rows
      .map((r) => (r as Record<string, unknown>)["prospect_score_at_contact"])
      .filter((s): s is number => typeof s === "number");
    const avgScore = scoresAtContact.length > 0
      ? Math.round(scoresAtContact.reduce((a, b) => a + b, 0) / scoresAtContact.length)
      : null;

    return reply.status(200).send({
      data: campaign,
      stats: {
        contacted,
        responded,
        closed_won: closedWon,
        conversion_rate: contacted > 0 ? Math.round((closedWon / contacted) * 1000) / 10 : 0,
        avg_score_contacted: avgScore,
      },
    });
  });

  // PATCH /api/v1/campaigns/:id — update name/status/notes
  app.patch("/campaigns/:id", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (!uuidSchema.safeParse(id).success) {
      return reply.status(400).send({ error: "Invalid campaign id" });
    }

    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.issues });
    }

    const db = getDb();
    const { data: existing, error: fetchErr } = await db
      .from("outreach_campaigns")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    if (authUser.role !== "admin" && (existing as Record<string, unknown>)["user_id"] !== authUser.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch["name"] = parsed.data.name;
    if (parsed.data.notes !== undefined) patch["notes"] = parsed.data.notes;
    if (parsed.data.segment_filter !== undefined) patch["segment_filter"] = parsed.data.segment_filter;
    if (parsed.data.status !== undefined) {
      patch["status"] = parsed.data.status;
      if (parsed.data.status === "closed") patch["closed_at"] = new Date().toISOString();
    }

    const { data, error } = await db
      .from("outreach_campaigns")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "campaign update failed");
      return reply.status(500).send({ error: "Database error" });
    }

    return reply.status(200).send({ data });
  });

  // DELETE /api/v1/campaigns/:id — soft-close (sets status=closed)
  app.delete("/campaigns/:id", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (!uuidSchema.safeParse(id).success) {
      return reply.status(400).send({ error: "Invalid campaign id" });
    }

    const db = getDb();
    const { data: existing, error: fetchErr } = await db
      .from("outreach_campaigns")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    if (authUser.role !== "admin" && (existing as Record<string, unknown>)["user_id"] !== authUser.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const { error } = await db
      .from("outreach_campaigns")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      request.log.error({ error }, "campaign delete/close failed");
      return reply.status(500).send({ error: "Database error" });
    }

    return reply.status(204).send();
  });
}
