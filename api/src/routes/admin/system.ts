import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/system/status", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const [configResult, lastRunResult] = await Promise.all([
      db.from("pipeline_config").select("*").eq("id", "singleton").single(),
      db
        .from("pipeline_runs")
        .select("id, status, completed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const config = configResult.data;
    const lastRun = lastRunResult.data;

    const cronMissed =
      config?.enabled &&
      config.scheduled_for &&
      new Date(config.scheduled_for).getTime() < Date.now() - 15 * 60 * 1000 &&
      (!config.last_completed_at ||
        new Date(config.last_completed_at) < new Date(config.scheduled_for));

    return reply.status(200).send({
      data: {
        db: "connected",
        last_run: lastRun ?? null,
        cron: {
          enabled: config?.enabled ?? false,
          scheduled_for: config?.scheduled_for ?? null,
          last_completed_at: config?.last_completed_at ?? null,
          missed: cronMissed ?? false,
        },
        ts: new Date().toISOString(),
      },
    });
  });

  // POST /admin/system/restart-core and /restart-api
  // Stub until Fase 48 (pm2 setup). Returns 501 in dev, would signal pm2 in production.
  const restartStub = async (_request: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (process.env["NODE_ENV"] !== "production") {
      return reply.status(501).send({
        error: "Restart disabled in dev",
        error_code: "restart_disabled_in_dev",
      });
    }
    return reply.status(501).send({
      error: "Not implemented",
      error_code: "restart_not_configured",
    });
  };

  app.post("/admin/system/restart-core", { preHandler: requireAdmin }, restartStub);
  app.post("/admin/system/restart-api", { preHandler: requireAdmin }, restartStub);
}
