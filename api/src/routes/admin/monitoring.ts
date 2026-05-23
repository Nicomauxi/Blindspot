import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../auth/middleware.js";
import { buildMonitoringOverview } from "../../modules/monitoring/service.js";

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/monitoring/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const data = await buildMonitoringOverview();
    return reply.status(200).send({ data });
  });
}
