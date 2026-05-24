import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";
import { buildMonitoringOverview } from "../../modules/monitoring/service.js";

const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
type JobStatus = typeof JOB_STATUSES[number];

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/monitoring/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const data = await buildMonitoringOverview();
    return reply.status(200).send({ data });
  });

  app.get("/admin/monitoring/discovery-jobs", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();

    const { data: rows, error } = await db
      .from("discovery_jobs")
      .select("id, source, location, niche, status, created_at, error_message")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return reply.status(500).send({ error: "Failed to fetch discovery jobs" });

    const counts: Record<JobStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0 };
    const byStatus: Record<JobStatus, typeof rows> = { queued: [], running: [], completed: [], failed: [] };

    for (const row of (rows ?? [])) {
      const s = row.status as JobStatus;
      if (s in counts) {
        counts[s]++;
        if (byStatus[s].length < 15) byStatus[s].push(row);
      }
    }

    return reply.status(200).send({ data: { counts, by_status: byStatus } });
  });
}
