import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../../auth/middleware.js";

// Stub until Fase 44-pre creates llm_usage_log and google_places_budget_spent tables.
export async function costsRoutes(app: FastifyInstance): Promise<void> {
  const stub = async (_request: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(200).send({
      data: null,
      _data_not_ready: true,
      _note: "data_not_ready_until_phase_44",
    });

  app.get("/admin/costs/overview", { preHandler: requireAdmin }, stub);
  app.get("/admin/costs/history", { preHandler: requireAdmin }, stub);
}
