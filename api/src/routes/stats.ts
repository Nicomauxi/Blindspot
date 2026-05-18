import type { FastifyInstance } from "fastify";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // GET /stats/overview — aggregate lead stats
  app.get("/stats/overview", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const db = getDb();

    // For CM, we use their subset via lead_dashboard; for admin, full leads table
    // This is a simplified overview — full stats depend on lead_filter intersection
    const baseQuery =
      authUser.role === "admin"
        ? db.from("leads").select("id", { count: "exact", head: true }).eq("passed_filter", true)
        : db
            .from("lead_dashboard")
            .select("id", { count: "exact", head: true });

    const { count: totalLeads } = await baseQuery;

    const { count: outreachCount } = await (authUser.role === "cm"
      ? db
          .from("lead_outreach")
          .select("id", { count: "exact", head: true })
          .eq("user_id", authUser.id)
      : db.from("lead_outreach").select("id", { count: "exact", head: true }));

    return reply.status(200).send({
      data: {
        total_leads: totalLeads ?? 0,
        total_outreach: outreachCount ?? 0,
        ts: new Date().toISOString(),
      },
    });
  });

  // GET /stats/outreach — outreach funnel stats
  app.get("/stats/outreach", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const db = getDb();

    let query = db
      .from("lead_outreach")
      .select("status", { count: "exact" });

    if (authUser.role === "cm") {
      query = query.eq("user_id", authUser.id);
    }

    const { data } = await query;
    return reply.status(200).send({ data: data ?? [] });
  });

  // GET /stats/pipeline — pipeline runs summary
  app.get("/stats/pipeline", { preHandler: requireAuth }, async (_request, reply) => {
    const db = getDb();
    const { data } = await db
      .from("pipeline_runs")
      .select("status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(10);

    return reply.status(200).send({ data: data ?? [] });
  });
}
