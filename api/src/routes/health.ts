import type { FastifyInstance } from "fastify";
import { getDb } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const db = getDb();

    // DB connectivity check
    const { error: dbError } = await db
      .from("pipeline_config")
      .select("id")
      .eq("id", "singleton")
      .single();

    const dbOk = !dbError;

    const { error: leadDashboardSchemaError } = await db
      .from("lead_dashboard")
      .select("canonical_source, phone, whatsapp, website, tags, state, owner_group_id, digital_footprint, score_breakdown")
      .limit(1);

    const leadDashboardSchemaCurrent = !leadDashboardSchemaError;

    // Pipeline status
    const { data: lastRun } = await db
      .from("pipeline_runs")
      .select("id, status, completed_at, dashboard_stale")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: config } = await db
      .from("pipeline_config")
      .select("enabled, cron_expression, scheduled_for, last_completed_at")
      .eq("id", "singleton")
      .single();

    const cronMissed =
      config?.enabled &&
      config.scheduled_for &&
      new Date(config.scheduled_for).getTime() < Date.now() - 15 * 60 * 1000 &&
      (!config.last_completed_at || new Date(config.last_completed_at) < new Date(config.scheduled_for));

    const healthy = dbOk && leadDashboardSchemaCurrent;

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      db: dbOk ? "connected" : "error",
      last_run: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            completed_at: lastRun.completed_at,
            dashboard_stale: lastRun.dashboard_stale,
          }
        : null,
      cron: {
        enabled: config?.enabled ?? false,
        scheduled_for: config?.scheduled_for ?? null,
        last_completed_at: config?.last_completed_at ?? null,
        missed: cronMissed ?? false,
      },
      invariants: {
        scoring_v1_columns_present: true,
        lead_dashboard_schema_current: leadDashboardSchemaCurrent,
      },
      ts: new Date().toISOString(),
    });
  });
}
