import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";
import {
  getSchedulerStatus,
  getSchedulerUptimeSeconds,
  isSchedulerEmbedded,
  startEmbeddedScheduler,
  restartEmbeddedScheduler,
} from "../../modules/scheduler/runtime.js";
import { getSchedulerBuffer } from "../../modules/scheduler/log-buffer.js";

type MetricRow = {
  process: string;
  cpu_pct: number | null;
  mem_bytes: number | null;
  uptime_seconds: number;
  recorded_at: string;
};

const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const LOGS_PATH = join(process.cwd(), "logs", "api.log");

async function tailFile(filePath: string, maxLines: number): Promise<string[]> {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  // ── Process metrics (existing) ──────────────────────────────────────────────
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
    const latestMap = new Map<string, MetricRow>();
    for (const row of rows) latestMap.set(row.process, row);

    return reply.status(200).send({
      data: { current: Array.from(latestMap.values()), history: rows },
    });
  });

  // ── Scheduler status ─────────────────────────────────────────────────────────
  app.get("/admin/scheduler/status", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.status(200).send({
      data: {
        status: getSchedulerStatus(),
        uptime_seconds: getSchedulerUptimeSeconds(),
        embedded: isSchedulerEmbedded(),
      },
    });
  });

  // ── Start scheduler ──────────────────────────────────────────────────────────
  app.post("/admin/scheduler/start", { preHandler: requireAdmin }, async (request, reply) => {
    if (!isSchedulerEmbedded()) {
      return reply.status(422).send({
        error: "Scheduler not embedded. Set EMBED_SCHEDULER=true and restart the API.",
        error_code: "scheduler_not_embedded",
      });
    }
    if (getSchedulerStatus() === "running") {
      return reply.status(200).send({ data: { status: "running" } }); // Idempotent
    }
    try {
      await startEmbeddedScheduler();
      return reply.status(200).send({ data: { status: "running" } });
    } catch (err) {
      request.log.error({ err }, "Failed to start embedded scheduler");
      return reply.status(500).send({ error: "Failed to start scheduler", error_code: "scheduler_start_error" });
    }
  });

  // ── Restart scheduler ────────────────────────────────────────────────────────
  app.post("/admin/scheduler/restart", { preHandler: requireAdmin }, async (request, reply) => {
    if (!isSchedulerEmbedded()) {
      return reply.status(422).send({
        error: "Scheduler not embedded. Set EMBED_SCHEDULER=true and restart the API.",
        error_code: "scheduler_not_embedded",
      });
    }
    try {
      await restartEmbeddedScheduler();
      return reply.status(200).send({ data: { status: "running" } });
    } catch (err) {
      request.log.error({ err }, "Failed to restart embedded scheduler");
      return reply.status(500).send({ error: "Failed to restart scheduler", error_code: "scheduler_restart_error" });
    }
  });

  // ── Scheduler logs (in-memory buffer) ────────────────────────────────────────
  app.get("/admin/scheduler/logs", { preHandler: requireAdmin }, async (request, reply) => {
    const rawLimit = (request.query as { limit?: string }).limit;
    const limit = Math.min(Math.max(Number(rawLimit ?? "200") || 200, 1), 500);
    const lines = getSchedulerBuffer().slice(-limit);
    return reply.status(200).send({ data: lines });
  });

  // ── API process logs (tail of logs/api.log) ───────────────────────────────────
  app.get("/admin/scheduler/api-logs", { preHandler: requireAdmin }, async (request, reply) => {
    const rawLimit = (request.query as { limit?: string }).limit;
    const limit = Math.min(Math.max(Number(rawLimit ?? "200") || 200, 1), 500);
    const rawLines = await tailFile(LOGS_PATH, limit);

    const parsed = rawLines.map((line) => {
      try {
        const obj = JSON.parse(line) as { time?: number; level?: number; msg?: string };
        const ts = obj.time ? new Date(obj.time).toISOString() : new Date().toISOString();
        const levelNum = obj.level ?? 30;
        const level = levelNum >= 50 ? "error" : levelNum >= 40 ? "warn" : "info";
        return { ts, level, msg: obj.msg ?? line };
      } catch {
        return { ts: new Date().toISOString(), level: "info", msg: line };
      }
    });

    return reply.status(200).send({ data: parsed });
  });
}
