import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { getAuthUser } from "../auth/middleware.js";
import {
  listAlerts,
  markAlertRead,
  archiveAlert,
  getUnreadCount,
} from "../../../src/storage/alerts.js";

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  // GET /alerts — list for current user (broadcast + targeted), optionally filtered by status
  app.get("/alerts", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const query = request.query as { status?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit ?? "20", 10) || 20, 100);
    const status = ["pending", "read", "archived"].includes(query.status ?? "")
      ? (query.status as "pending" | "read" | "archived")
      : undefined;

    const alerts = await listAlerts(authUser.id, { status, limit });
    return reply.status(200).send({ data: alerts });
  });

  // GET /alerts/unread-count — badge counter
  app.get("/alerts/unread-count", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const count = await getUnreadCount(authUser.id);
    return reply.status(200).send({ data: { count } });
  });

  // POST /alerts/:id/read — mark as read
  app.post("/alerts/:id/read", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    await markAlertRead(id, authUser.id);
    return reply.status(200).send({ data: { id, status: "read" } });
  });

  // POST /alerts/:id/archive — archive
  app.post("/alerts/:id/archive", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    await archiveAlert(id, authUser.id);
    return reply.status(200).send({ data: { id, status: "archived" } });
  });
}
