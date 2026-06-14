import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";
import { buildResourceSnapshot } from "../../modules/monitoring/resources.js";
import { getSocialEnrichJobState, launchSocialEnrichJob } from "../../modules/social-enrich/launcher.js";

const DEFAULT_MAX_CPU_PCT = 80;
const DEFAULT_MAX_RAM_PCT = 80;

const launchSchema = z.object({
  limit: z.number().int().min(1).max(8000).default(1000),
  force: z.boolean().default(false),
});

async function readResourceCaps(): Promise<{ maxCpu: number; maxRam: number }> {
  try {
    const { data } = await getDb()
      .from("pipeline_config")
      .select("max_cpu_pct, max_ram_pct")
      .eq("id", "singleton")
      .single();
    return {
      maxCpu: typeof data?.max_cpu_pct === "number" ? data.max_cpu_pct : DEFAULT_MAX_CPU_PCT,
      maxRam: typeof data?.max_ram_pct === "number" ? data.max_ram_pct : DEFAULT_MAX_RAM_PCT,
    };
  } catch {
    return { maxCpu: DEFAULT_MAX_CPU_PCT, maxRam: DEFAULT_MAX_RAM_PCT };
  }
}

export async function socialEnrichRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/social-enrich/jobs/current", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.status(200).send({ data: getSocialEnrichJobState() });
  });

  app.post("/admin/social-enrich/jobs", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = launchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    if (getSocialEnrichJobState().running) {
      return reply.status(409).send({
        error: "A social-enrich job is already running",
        error_code: "already_running",
        details: getSocialEnrichJobState(),
      });
    }

    // Resource guard: no lanzar el subproceso (browser incluido) si el host ya está
    // por encima de los caps configurados en Variables.
    const { maxCpu, maxRam } = await readResourceCaps();
    const snapshot = await buildResourceSnapshot();
    if (snapshot.cpu.pct > maxCpu || snapshot.ram.pct > maxRam) {
      return reply.status(429).send({
        error: "Host resources above configured caps",
        error_code: "resources_exceeded",
        details: {
          cpu_pct: snapshot.cpu.pct,
          ram_pct: snapshot.ram.pct,
          max_cpu_pct: maxCpu,
          max_ram_pct: maxRam,
        },
      });
    }

    try {
      const job = launchSocialEnrichJob({
        limit: parsed.data.limit,
        force: parsed.data.force,
        startedAtIso: new Date().toISOString(),
      });
      return reply.status(202).send({ data: job });
    } catch (err) {
      request.log.error({ err }, "Failed to launch social-enrich subprocess");
      return reply.status(500).send({ error: "Launch failed", error_code: "launch_failed" });
    }
  });
}
