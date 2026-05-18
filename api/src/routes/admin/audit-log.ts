import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const querySchema = z.object({
  actor: permissiveUuid.optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: permissiveUuid.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

export async function auditLogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/audit-log", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = querySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { actor, action, from, to, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("occurred_at", { ascending: false })
      .limit(limit + 1);

    if (actor) query = query.eq("actor_user_id", actor);
    if (action) query = query.eq("action", action);
    if (from) query = query.gte("occurred_at", from);
    if (to) query = query.lte("occurred_at", to);

    if (cursor) {
      const { data: cursorRow } = await db
        .from("audit_log")
        .select("occurred_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("occurred_at", (cursorRow as { occurred_at: string }).occurred_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      request.log.error({ error }, "audit log query error");
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
}
