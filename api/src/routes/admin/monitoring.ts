import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";
import { buildMonitoringOverview } from "../../modules/monitoring/service.js";

const JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
type JobStatus = typeof JOB_STATUSES[number];

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/monitoring/overview", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const data = await buildMonitoringOverview();
      return reply.status(200).send({ data });
    } catch (err) {
      request.log.error({ err }, "Failed to build monitoring overview");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });

  app.get("/admin/monitoring/discovery-jobs", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();

    // Fetch exact counts per status via parallel queries
    const [recentRes, queuedCountRes, runningCountRes, completedCountRes, failedCountRes] = await Promise.all([
      db
        .from("discovery_jobs")
        .select("id, source, location, niche, status, created_at, error_message")
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "queued"),
      db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "running"),
      db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "completed"),
      db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "failed"),
    ]);

    if (recentRes.error) return reply.status(500).send({ error: "Failed to fetch discovery jobs" });

    const counts: Record<JobStatus, number> = {
      queued: queuedCountRes.count ?? 0,
      running: runningCountRes.count ?? 0,
      completed: completedCountRes.count ?? 0,
      failed: failedCountRes.count ?? 0,
    };

    const byStatus: Record<JobStatus, (typeof recentRes.data)[number][]> = { queued: [], running: [], completed: [], failed: [] };
    for (const row of (recentRes.data ?? [])) {
      const s = row.status as JobStatus;
      if (s in byStatus && byStatus[s].length < 15) byStatus[s].push(row);
    }

    return reply.status(200).send({ data: { counts, by_status: byStatus } });
  });
}
