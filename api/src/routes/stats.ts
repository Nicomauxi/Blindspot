import { fetchAllRows } from "../services/fetch-all-rows.js";
import { passesLeadFilter } from "../services/lead-filter.js";
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

    const { data, error } = await query;
    if (error) {
      request.log.error({ error }, "stats outreach query failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
    return reply.status(200).send({ data: data ?? [] });
  });

  // GET /stats/pipeline — pipeline runs summary
  app.get("/stats/pipeline", { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("pipeline_runs")
      .select("status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      request.log.error({ error }, "stats pipeline query failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
    return reply.status(200).send({ data: data ?? [] });
  });

  // GET /stats/segments — segment breakdown by niche, tier, source
  app.get("/stats/segments", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const db = getDb();
    const view = authUser.role === "cm" ? "lead_dashboard" : "leads";

    type Row = { niche: string | null; prospect_score: number | null; contact_tier: string | null; source?: string };

    // N92: paginar con range (PostgREST capa a 1000 → los agregados estaban
    // subcontados ~1000/5593) y traer las columnas que el lead_filter del cm necesita.
    const allRows = await fetchAllRows<Row & Record<string, unknown>>((from, to) =>
      db
        .from(view)
        .select("niche, prospect_score, contact_tier, source, primary_offer, contacted_at, tags, inferred_state, lead_company_data")
        .range(from, to)
    );

    // N92: un cm solo ve la distribución de SU segmento (mismo gate que GET /leads).
    const scopedRows =
      authUser.role === "cm" && authUser.lead_filter
        ? allRows.filter((row) => passesLeadFilter(row, authUser.lead_filter as Record<string, unknown>))
        : allRows;

    const nicheRes = { data: scopedRows };
    const tierRes = { data: scopedRows.filter((r) => r.contact_tier != null) };
    const sourceRes = { data: scopedRows.filter((r) => r.source != null) };

    function aggregate(rows: Row[], key: keyof Row) {
      const map: Record<string, { count: number; total_score: number; count_scored: number }> = {};
      for (const row of rows) {
        const val = String(row[key] ?? "unknown");
        if (!map[val]) map[val] = { count: 0, total_score: 0, count_scored: 0 };
        map[val].count++;
        if (row.prospect_score != null) {
          map[val].total_score += row.prospect_score;
          map[val].count_scored++;
        }
      }
      return Object.entries(map)
        .map(([value, stats]) => ({
          value,
          count: stats.count,
          avg_score: stats.count_scored > 0 ? Math.round(stats.total_score / stats.count_scored) : null,
        }))
        .sort((a, b) => b.count - a.count);
    }

    return reply.status(200).send({
      data: {
        by_niche: aggregate((nicheRes.data ?? []) as Row[], "niche"),
        by_tier: aggregate((tierRes.data ?? []) as Row[], "contact_tier"),
        by_source: aggregate((sourceRes.data ?? []) as Row[], "source"),
      },
    });
  });
}
