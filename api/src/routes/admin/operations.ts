import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

type MetricRow = {
  process: string;
  cpu_pct: number | null;
  mem_bytes: number | null;
  uptime_seconds: number;
  recorded_at: string;
};

const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/operations/process-metrics", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();

    const { data, error } = await db
      .from("process_metrics")
      .select("process, cpu_pct, mem_bytes, uptime_seconds, recorded_at")
      .gte("recorded_at", cutoff)
      .order("recorded_at", { ascending: true });

    if (error) return reply.status(500).send({ error: "Failed to fetch process metrics" });

    const rows = (data ?? []) as MetricRow[];

    // Latest snapshot per process
    const latestMap = new Map<string, MetricRow>();
    for (const row of rows) {
      latestMap.set(row.process, row);
    }

    return reply.status(200).send({
      data: {
        current: Array.from(latestMap.values()),
        history: rows,
      },
    });
  });
}
