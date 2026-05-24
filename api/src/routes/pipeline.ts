import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser } from "../auth/middleware.js";
import { getGooglePlacesBudgetStatus } from "../../../src/storage/pipeline-config.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const configPutSchema = z.object({
  enabled: z.boolean().optional(),
  cron_expression: z.string().min(1).optional(),
  phases: z.record(z.string(), z.unknown()).optional(),
  notify_webhook_url: z.string().url().nullable().optional(),
  notify_webhook_secret: z.string().min(8).nullable().optional(),
  notify_webhook_events: z.array(z.enum(["run_completed", "new_hot_leads"])).optional(),
});

const runBodySchema = z.object({
  overrides: z.record(z.string(), z.unknown()).optional(),
  dry_run: z.boolean().optional(),
});

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

const runsQuerySchema = z.object({
  status: z.string().optional(),
  cursor: permissiveUuid.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "20"), 100))
    .pipe(z.number().int().min(1).max(100)),
});

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  // GET /pipeline/config — admin only
  app.get("/pipeline/config", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("pipeline_config")
      .select("*")
      .eq("id", "singleton")
      .single();

    if (error || !data) {
      return reply.status(500).send({ error: "Config not found", error_code: "config_missing" });
    }

    return reply.status(200).send({ data });
  });

  // PUT /pipeline/config — admin only (full replace of mutable fields)
  app.put("/pipeline/config", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = configPutSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const body = parseResult.data;
    if (body.enabled !== undefined) update["enabled"] = body.enabled;
    if (body.cron_expression !== undefined) {
      update["cron_expression"] = body.cron_expression;
      // Compute next scheduled_for
      try {
        const { CronExpressionParser } = await import("cron-parser");
        const interval = CronExpressionParser.parse(body.cron_expression);
        update["scheduled_for"] = interval.next().toDate().toISOString();
      } catch {
        return reply.status(400).send({
          error: "Invalid cron expression",
          error_code: "invalid_cron_expression",
        });
      }
    }
    if (body.phases !== undefined) update["phases"] = body.phases;
    if (body.notify_webhook_url !== undefined) update["notify_webhook_url"] = body.notify_webhook_url;
    if (body.notify_webhook_secret !== undefined) update["notify_webhook_secret"] = body.notify_webhook_secret;
    if (body.notify_webhook_events !== undefined) update["notify_webhook_events"] = body.notify_webhook_events;

    const db = getDb();
    const { data, error } = await db
      .from("pipeline_config")
      .update(update)
      .eq("id", "singleton")
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "pipeline config update error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(200).send({ data });
  });

  // PATCH /pipeline/config — admin only (partial update, same as PUT here)
  app.patch("/pipeline/config", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = configPutSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const body = parseResult.data;
    if (body.enabled !== undefined) update["enabled"] = body.enabled;
    if (body.cron_expression !== undefined) {
      update["cron_expression"] = body.cron_expression;
      try {
        const { CronExpressionParser } = await import("cron-parser");
        const interval = CronExpressionParser.parse(body.cron_expression);
        update["scheduled_for"] = interval.next().toDate().toISOString();
      } catch {
        return reply.status(400).send({
          error: "Invalid cron expression",
          error_code: "invalid_cron_expression",
        });
      }
    }
    if (body.phases !== undefined) update["phases"] = body.phases;
    if (body.notify_webhook_url !== undefined) update["notify_webhook_url"] = body.notify_webhook_url;
    if (body.notify_webhook_secret !== undefined) update["notify_webhook_secret"] = body.notify_webhook_secret;
    if (body.notify_webhook_events !== undefined) update["notify_webhook_events"] = body.notify_webhook_events;

    const db = getDb();
    const { data, error } = await db
      .from("pipeline_config")
      .update(update)
      .eq("id", "singleton")
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "pipeline config patch error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(200).send({ data });
  });

  // POST /pipeline/run — admin only
  app.post("/pipeline/run", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = runBodySchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { overrides, dry_run } = parseResult.data;
    const queryDryRun = request.query && typeof request.query === "object"
      ? (request.query as Record<string, unknown>)["dry_run"] === "true"
      : false;
    const effectiveDryRun = dry_run === true || queryDryRun;

    const authUser = getAuthUser(request);

    const db = getDb();

    // Check no running run already active
    const { data: activeRun } = await db
      .from("pipeline_runs")
      .select("id, status")
      .in("status", [...ACTIVE_RUN_STATUSES])
      .limit(1)
      .maybeSingle();

    if (activeRun) {
      return reply.status(409).send({
        error: "A pipeline run is already in progress",
        error_code: "run_already_active",
        active_run_id: (activeRun as { id: string }).id,
      });
    }

    const { data: run, error: insertError } = await db
      .from("pipeline_runs")
      .insert({
        status: "pending",
        triggered_by: "manual",
        overrides: {
          ...(overrides ?? {}),
          ...(effectiveDryRun ? { dry_run: true } : {}),
        },
        log_lines: [
          {
            ts: new Date().toISOString(),
            level: "info",
            msg: effectiveDryRun
              ? `Dry-run queued by ${authUser.email}`
              : `Run queued by ${authUser.email}`,
          },
        ],
      })
      .select()
      .single();

    if (insertError) {
      request.log.error({ error: insertError }, "pipeline run insert error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    // Notify core via pg_notify (best-effort — core also polls)
    try {
      await db.rpc("pg_notify_pipeline_trigger", { run_id: (run as { id: string }).id });
    } catch {
      // pg_notify via RPC may not exist — core will pick it up via polling
    }

    return reply.status(202).send({
      data: {
        run_id: (run as { id: string }).id,
        dry_run: effectiveDryRun,
      },
    });
  });

  // POST /pipeline/run/dry — admin only
  app.post("/pipeline/run/dry", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = runBodySchema.safeParse({
      ...(typeof request.body === "object" && request.body ? request.body as Record<string, unknown> : {}),
      dry_run: true,
    });
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const token = request.headers.authorization;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: {
        ...(token ? { authorization: token } : {}),
        "content-type": "application/json",
      },
      payload: JSON.stringify(parseResult.data),
    });

    return reply.status(res.statusCode).send(res.json());
  });

  // POST /pipeline/abort — admin only
  app.post("/pipeline/abort", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data: activeRun } = await db
      .from("pipeline_runs")
      .select("id")
      .in("status", [...ACTIVE_RUN_STATUSES])
      .limit(1)
      .maybeSingle();

    if (!activeRun) {
      return reply.status(404).send({
        error: "No active run to abort",
        error_code: "no_active_run",
      });
    }

    const { error } = await db
      .from("pipeline_runs")
      .update({ abort_requested: true })
      .eq("id", (activeRun as { id: string }).id);

    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(200).send({
      data: { run_id: (activeRun as { id: string }).id, abort_requested: true },
    });
  });

  // GET /pipeline/runs — admin only
  app.get("/pipeline/runs", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = runsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { status, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("pipeline_runs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      query = query.in("status", statuses);
    }

    if (cursor) {
      const { data: cursorRow } = await db
        .from("pipeline_runs")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null
      : null;

    return reply.status(200).send({ data: page, next_cursor: nextCursor, total: count ?? 0 });
  });

  // GET /pipeline/runs/active — admin only
  app.get("/pipeline/runs/active", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data } = await db
      .from("pipeline_runs")
      .select("*")
      .eq("status", "running")
      .limit(1)
      .maybeSingle();

    return reply.status(200).send({ data: data ?? null });
  });

  // GET /pipeline/runs/:id — admin only
  app.get("/pipeline/runs/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const { data, error } = await db
      .from("pipeline_runs")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: "Run not found", error_code: "not_found" });
    }

    return reply.status(200).send({ data });
  });

  // POST /pipeline/webhook/test — admin only
  app.post("/pipeline/webhook/test", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data } = await db
      .from("pipeline_config")
      .select("notify_webhook_url, notify_webhook_secret, notify_webhook_events")
      .eq("id", "singleton")
      .single();

    const url = (data?.notify_webhook_url as string | null) ?? null;
    if (!url) {
      return reply.status(400).send({
        error: "No webhook URL configured",
        error_code: "webhook_not_configured",
      });
    }

    const { createHmac } = await import("crypto");
    const { fetch } = await import("undici");

    const secret = (data?.notify_webhook_secret as string | null) ?? null;
    const body = JSON.stringify({
      event: "test",
      run_id: null,
      ts: new Date().toISOString(),
      message: "Blindspot webhook test",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Blindspot-Event": "test",
    };
    if (secret) {
      const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
      headers["X-Blindspot-Signature"] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return reply.status(200).send({
        data: {
          status: res.ok ? "sent" : "failed",
          http_status: res.status,
          url,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(200).send({
        data: { status: "failed", error: msg, url },
      });
    }
  });

  // GET /pipeline/runs/:id/log — admin only
  app.get(
    "/pipeline/runs/:id/log",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { since } = request.query as { since?: string };
      const db = getDb();
      const { data, error } = await db
        .from("pipeline_runs")
        .select("log_lines")
        .eq("id", id)
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: "Run not found", error_code: "not_found" });
      }

      let lines = (data as { log_lines: unknown[] }).log_lines ?? [];
      if (since) {
        const sinceTs = new Date(since).getTime();
        lines = lines.filter((l) => {
          const line = l as { ts?: string };
          return line.ts ? new Date(line.ts).getTime() > sinceTs : true;
        });
      }

      return reply.status(200).send({ data: lines });
    }
  );

  // PUT /pipeline/config/max-jobs — admin only (safe JSONB merge for phases.discovery.max_jobs)
  app.put("/pipeline/config/max-jobs", { preHandler: requireAdmin }, async (request, reply) => {
    const schema = z.object({ max_jobs: z.number().int().min(1).max(50) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", issues: parsed.error.flatten() });
    }
    const { max_jobs } = parsed.data;

    const db = getDb();
    const { data: current, error: readError } = await db
      .from("pipeline_config")
      .select("phases")
      .eq("id", "singleton")
      .single();

    if (readError || !current) return reply.status(500).send({ error: "Config not found" });

    const phases = current["phases"] as Record<string, unknown> ?? {};
    const discovery = (phases["discovery"] as Record<string, unknown>) ?? {};
    const updatedPhases = { ...phases, discovery: { ...discovery, max_jobs } };

    const { error } = await db
      .from("pipeline_config")
      .update({ phases: updatedPhases, updated_at: new Date().toISOString() })
      .eq("id", "singleton");

    if (error) return reply.status(500).send({ error: "Update failed" });

    return reply.status(200).send({ data: { max_jobs } });
  });

  // GET /pipeline/gp-budget — admin only
  app.get("/pipeline/gp-budget", { preHandler: requireAdmin }, async (_request, reply) => {
    const status = await getGooglePlacesBudgetStatus();
    if (!status) return reply.status(500).send({ error: "budget_unavailable" });
    return reply.status(200).send({ data: status });
  });

  // PUT /pipeline/gp-budget — admin only
  app.put("/pipeline/gp-budget", { preHandler: requireAdmin }, async (request, reply) => {
    const schema = z.object({
      budget_total: z.number().positive().optional(),
      alert_threshold: z.number().positive().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", issues: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (body.budget_total === undefined && body.alert_threshold === undefined) {
      return reply.status(400).send({ error: "Provide budget_total and/or alert_threshold" });
    }
    const db = getDb();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.budget_total !== undefined) {
      update["google_places_budget_total"] = body.budget_total;
    }
    if (body.alert_threshold !== undefined) update["google_places_alert_threshold"] = body.alert_threshold;
    const { error } = await db.from("pipeline_config").update(update).eq("id", "singleton");
    if (error) return reply.status(500).send({ error: "Update failed" });
    const status = await getGooglePlacesBudgetStatus();
    return reply.status(200).send({ data: status });
  });

  // POST /pipeline/gp-budget/reset-spent — admin only
  app.post("/pipeline/gp-budget/reset-spent", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const { error } = await db
      .from("pipeline_config")
      .update({ google_places_budget_spent: 0, updated_at: new Date().toISOString() })
      .eq("id", "singleton");
    if (error) return reply.status(500).send({ error: "Reset failed" });
    const status = await getGooglePlacesBudgetStatus();
    return reply.status(200).send({ data: status });
  });
}
