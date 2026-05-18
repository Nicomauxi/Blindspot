import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../auth/middleware.js";

// Stub until Fase 45-pre creates pipeline_errors and change detection tables.
export async function performanceRoutes(app: FastifyInstance): Promise<void> {
  const stub = async (_request: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(200).send({
      data: null,
      _data_not_ready: true,
      _note: "data_not_ready_until_phase_45",
    });

  app.get("/admin/performance/overview", { preHandler: requireAdmin }, stub);
  app.get("/admin/performance/errors", { preHandler: requireAdmin }, stub);
  app.get("/admin/performance/quality", { preHandler: requireAdmin }, stub);
}
