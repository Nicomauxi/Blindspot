import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser } from "../auth/middleware.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const createJobSchema = z.object({
  source: z.string().min(1),
  location: z.string().min(1),
  niche: z.string().optional(),
  profile: z.enum(["A", "B", "C", "D"]).optional(),
  max_results: z.number().int().min(1).max(1000).default(200),
  concurrency: z.number().int().min(1).max(10).optional(),
  cpu_budget: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
});

const patchJobSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

const listJobsQuerySchema = z.object({
  status: z.string().optional(),
  cursor: permissiveUuid.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

const JOB_STATUS_TRANSITIONS: Record<string, string> = {
  pause: "paused",
  resume: "queued",
  cancel: "cancelled",
};

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  // GET /discovery/jobs — admin or CM
  app.get("/discovery/jobs", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = listJobsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { status, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("discovery_jobs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    // CM sees only their own jobs
    if (authUser.role === "cm") {
      query = query.eq("user_id", authUser.id);
    }

    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      query = query.in("status", statuses);
    }

    if (cursor) {
      const { data: cursorRow } = await db
        .from("discovery_jobs")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      request.log.error({ error }, "discovery jobs list error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null
      : null;

    return reply.status(200).send({ data: page, next_cursor: nextCursor, total: count ?? 0 });
  });

  // POST /discovery/jobs — admin only
  app.post("/discovery/jobs", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = createJobSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const authUser = getAuthUser(request);
    const body = parseResult.data;
    const db = getDb();

    const { data: job, error } = await db
      .from("discovery_jobs")
      .insert({
        source: body.source,
        location: body.location,
        niche: body.niche ?? null,
        profile: body.profile ?? null,
        max_results: body.max_results,
        concurrency: body.concurrency ?? null,
        cpu_budget: body.cpu_budget,
        status: "queued",
        triggered_by: "manual",
        user_id: authUser.id,
      })
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "discovery job create error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(201).send({ data: job });
  });

  // PATCH /discovery/jobs/:id — admin only (pause/resume/cancel)
  app.patch(
    "/discovery/jobs/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parseResult = patchJobSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const db = getDb();
      const { data: job, error: fetchError } = await db
        .from("discovery_jobs")
        .select("id, status")
        .eq("id", id)
        .single();

      if (fetchError || !job) {
        return reply.status(404).send({ error: "Job not found", error_code: "not_found" });
      }

      const { action } = parseResult.data;
      const newStatus = JOB_STATUS_TRANSITIONS[action];

      const { data: updated, error: updateError } = await db
        .from("discovery_jobs")
        .update({ status: newStatus })
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({ data: updated });
    }
  );

  // GET /discovery/suggestions — intentionally unavailable until gap analysis exists
  app.get("/discovery/suggestions", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.status(501).send({
      error: "Discovery suggestions are not available in the current jobs-only control center",
      error_code: "feature_not_available",
      capability: "jobs_only",
    });
  });

  // GET /discovery/coverage — intentionally unavailable until there is a real coverage model
  app.get("/discovery/coverage", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.status(501).send({
      error: "Discovery coverage is not available in the current jobs-only control center",
      error_code: "feature_not_available",
      capability: "jobs_only",
    });
  });
}
