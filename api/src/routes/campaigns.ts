import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

// Stub until Fase 43 implements outreach_campaigns table and logic.
export async function campaignsRoutes(app: FastifyInstance): Promise<void> {
  const stub501 = async (_request: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) =>
    reply.status(501).send({
      error: "Not implemented",
      error_code: "not_implemented_until_phase_43",
    });

  app.get("/campaigns", { preHandler: requireAuth }, stub501);
  app.post("/campaigns", { preHandler: requireAuth }, stub501);
  app.get("/campaigns/:id", { preHandler: requireAuth }, stub501);
  app.patch("/campaigns/:id", { preHandler: requireAuth }, stub501);
  app.delete("/campaigns/:id", { preHandler: requireAuth }, stub501);
}
