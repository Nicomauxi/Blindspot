import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
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

const PORT = Number(process.env["PORT"] ?? 3001);
const CORS_ORIGIN = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";

export async function buildServer() {
  const jwtSecret = process.env["API_JWT_SECRET"];
  if (!jwtSecret) throw new Error("API_JWT_SECRET is required");

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
  await app.register(helmet);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(jwt, { secret: jwtSecret });

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
  await app.register(costsRoutes, { prefix: "/api/v1" });
  await app.register(performanceRoutes, { prefix: "/api/v1" });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  }
}
