import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { authRoutes } from "./auth/routes.js";
import { healthRoutes } from "./routes/health.js";
import { leadsRoutes } from "./routes/leads.js";
import { outreachRoutes } from "./routes/outreach.js";

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
