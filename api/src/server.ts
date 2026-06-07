import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { authRoutes } from "./auth/routes.js";
import { healthRoutes } from "./routes/health.js";
import { leadsRoutes } from "./routes/leads.js";
import { outreachRoutes } from "./routes/outreach.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { campaignsRoutes } from "./routes/campaigns.js";
import { usersRoutes } from "./routes/users.js";
import { statsRoutes } from "./routes/stats.js";
import { auditLogRoutes } from "./routes/admin/audit-log.js";
import { systemRoutes } from "./routes/admin/system.js";
import { costsRoutes } from "./routes/admin/costs.js";
import { performanceRoutes } from "./routes/admin/performance.js";
import { monitoringRoutes } from "./routes/admin/monitoring.js";
import { servicePricingRoutes } from "./routes/service-pricing.js";
import { backupsRoutes } from "./routes/admin/backups.js";
import { variablesRoutes } from "./routes/admin/variables.js";
import { operationsRoutes } from "./routes/admin/operations.js";
import { trackingRoutes } from "./routes/tracking.js";
import { discoveryPlacesRoutes } from "./routes/admin/discovery-places.js";
import { alertsRoutes } from "./routes/alerts.js";
import { nichesRoutes } from "./routes/admin/niches.js";
import { mergeCandidatesRoutes } from "./routes/admin/merge-candidates.js";
import { getBackupScheduler } from "./modules/backups/runtime.js";
import { startProcessMetricsRecorder, stopProcessMetricsRecorder } from "./modules/process-metrics/recorder.js";
import { startEmbeddedScheduler, stopEmbeddedScheduler, isSchedulerEmbedded, getSchedulerStatus } from "./modules/scheduler/runtime.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const CORS_ORIGIN = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";

function normalizeOrigins(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isAllowedDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return true;
    return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

export async function buildServer() {
  const jwtSecret = process.env["API_JWT_SECRET"];
  if (!jwtSecret) throw new Error("API_JWT_SECRET is required");

  const app = Fastify({ logger: true });
  const explicitOrigins = normalizeOrigins(CORS_ORIGIN);

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowed =
        explicitOrigins.includes(origin) ||
        (process.env["NODE_ENV"] !== "production" && isAllowedDevelopmentOrigin(origin));

      callback(null, allowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(jwt, { secret: jwtSecret });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  await app.register(authRoutes);
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(leadsRoutes, { prefix: "/api/v1" });
  await app.register(outreachRoutes, { prefix: "/api/v1" });
  await app.register(pipelineRoutes, { prefix: "/api/v1" });
  await app.register(discoveryRoutes, { prefix: "/api/v1" });
  await app.register(campaignsRoutes, { prefix: "/api/v1" });
  await app.register(usersRoutes, { prefix: "/api/v1" });
  await app.register(statsRoutes, { prefix: "/api/v1" });
  await app.register(auditLogRoutes, { prefix: "/api/v1" });
  await app.register(systemRoutes, { prefix: "/api/v1" });
  await app.register(backupsRoutes, { prefix: "/api/v1" });
  await app.register(costsRoutes, { prefix: "/api/v1" });
  await app.register(performanceRoutes, { prefix: "/api/v1" });
  await app.register(monitoringRoutes, { prefix: "/api/v1" });
  await app.register(variablesRoutes, { prefix: "/api/v1" });
  await app.register(operationsRoutes, { prefix: "/api/v1" });
  await app.register(servicePricingRoutes, { prefix: "/api/v1" });
  await app.register(trackingRoutes, { prefix: "/api/v1" });
  await app.register(discoveryPlacesRoutes, { prefix: "/api/v1" });
  await app.register(alertsRoutes, { prefix: "/api/v1" });
  await app.register(nichesRoutes, { prefix: "/api/v1" });
  await app.register(mergeCandidatesRoutes, { prefix: "/api/v1" });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const backupScheduler = getBackupScheduler();
  await backupScheduler.start();
  startProcessMetricsRecorder();

  // Embed the PipelineScheduler (core worker) when EMBED_SCHEDULER=true.
  // This allows a single 'pnpm --dir api dev' to handle both API and job processing.
  // Guard: skip if already running (tsx --watch re-executes this block on hot-reload).
  if (isSchedulerEmbedded() && getSchedulerStatus() !== "running") {
    await startEmbeddedScheduler();
  }

  const app = await buildServer();
  const shutdown = () => {
    backupScheduler.stop();
    stopProcessMetricsRecorder();
    if (isSchedulerEmbedded()) stopEmbeddedScheduler();
  };

  // Use once-per-signal registration to avoid duplicate listeners on tsx hot-reload.
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    shutdown();
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  }
}
