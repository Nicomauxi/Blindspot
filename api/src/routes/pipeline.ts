import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser } from "../auth/middleware.js";

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
    const authUser = getAuthUser(request);

    if (dry_run) {
      return reply.status(200).send({
        data: {
          dry_run: true,
          planned_phases: overrides ?? {},
          note: "Dry run — no run created",
        },
      });
    }

    const db = getDb();

    // Check no running run already active
    const { data: activeRun } = await db
      .from("pipeline_runs")
      .select("id, status")
      .eq("status", "running")
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
        triggered_by_user_id: authUser.id,
        overrides: overrides ?? null,
        log_lines: [],
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

    return reply.status(202).send({ data: { run_id: (run as { id: string }).id } });
  });

  // POST /pipeline/run/dry — admin only
  app.post("/pipeline/run/dry", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = runBodySchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }
    return reply.status(200).send({
      data: {
        dry_run: true,
        planned_phases: parseResult.data.overrides ?? {},
        note: "Dry run — no run created",
      },
    });
  });

  // POST /pipeline/abort — admin only
  app.post("/pipeline/abort", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data: activeRun } = await db
      .from("pipeline_runs")
      .select("id")
      .eq("status", "running")
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
}
