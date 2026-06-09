import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { getAuthUser, requireAdmin } from "../../auth/middleware.js";

type VarType = "boolean" | "number" | "string" | "string_array";

type VariableDef = {
  key: string;
  label: string;
  description: string;
  type: VarType;
  sensitive: boolean;
  nullable: boolean;
};

const VARIABLE_REGISTRY: VariableDef[] = [
  {
    key: "cron_enabled",
    label: "Cron habilitado",
    description: "Activa o desactiva la ejecución automática del pipeline por cron.",
    type: "boolean",
    sensitive: false,
    nullable: false,
  },
  {
    key: "cron_expression",
    label: "Expresión cron",
    description: "Expresión cron estándar de 5 campos que define cuándo corre el pipeline.",
    type: "string",
    sensitive: false,
    nullable: true,
  },
  {
    key: "max_jobs",
    label: "Jobs máximos por run",
    description: "Cantidad máxima de discovery jobs que el pipeline procesa por ejecución.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "google_places_budget_total",
    label: "Budget Google Places (USD)",
    description: "Presupuesto mensual máximo para Google Places API en dólares.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "google_places_alert_threshold",
    label: "Umbral de alerta GP (USD)",
    description: "Alerta cuando el budget restante cae por debajo de este valor.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "max_concurrent_runs",
    label: "Runs simultáneos máximos",
    description: "Cuántos runs puede correr el core a la vez (si los recursos lo permiten).",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "max_cpu_pct",
    label: "CPU máximo del host (%)",
    description: "El core no lanza un nuevo run si el CPU del host supera este porcentaje.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "max_ram_pct",
    label: "RAM máxima del host (%)",
    description: "El core no lanza un nuevo run si la RAM usada del host supera este porcentaje.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "max_enrich_threads",
    label: "Hilos máximos de enrichment",
    description: "Tope de concurrencia para los trabajos de enrichment.",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "fetch_timeout_ms",
    label: "Timeout de fetch (ms)",
    description: "Timeout por request HTTP del enrichment. Bajarlo acelera reprocesos (fail-fast en dominios muertos).",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "fetch_retries",
    label: "Reintentos de fetch",
    description: "Reintentos por request HTTP del enrichment. 0 = sin reintentos (más rápido).",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "enrich_heuristic_max_concurrency",
    label: "Cap heurístico de concurrencia",
    description: "Tope de hilos efectivos cuando el enrichment corre con heurística (muchos sub-requests por lead).",
    type: "number",
    sensitive: false,
    nullable: false,
  },
  {
    key: "webhook_url",
    label: "Webhook URL",
    description: "URL destino de las notificaciones de pipeline.",
    type: "string",
    sensitive: false,
    nullable: true,
  },
  {
    key: "webhook_secret",
    label: "Webhook secret",
    description: "Secret HMAC para firmar los payloads del webhook. Mínimo 8 caracteres.",
    type: "string",
    sensitive: true,
    nullable: true,
  },
  {
    key: "webhook_events",
    label: "Webhook events",
    description: "Eventos que disparan notificaciones: run_completed, new_hot_leads.",
    type: "string_array",
    sensitive: false,
    nullable: false,
  },
];

type PipelineConfigRow = {
  enabled: boolean;
  cron_expression: string | null;
  phases: Record<string, unknown> | null;
  google_places_budget_total: number;
  google_places_alert_threshold: number;
  notify_webhook_url: string | null;
  notify_webhook_secret: string | null;
  notify_webhook_events: string[];
  max_concurrent_runs: number;
  max_cpu_pct: number;
  max_ram_pct: number;
  max_enrich_threads: number;
  fetch_timeout_ms: number;
  fetch_retries: number;
  enrich_heuristic_max_concurrency: number;
};

type VariableValue = boolean | number | string | string[] | null;

export type VariableItem = VariableDef & { value: VariableValue };

const CONFIG_SELECT = "enabled, cron_expression, phases, google_places_budget_total, google_places_alert_threshold, notify_webhook_url, notify_webhook_secret, notify_webhook_events, max_concurrent_runs, max_cpu_pct, max_ram_pct, max_enrich_threads, fetch_timeout_ms, fetch_retries, enrich_heuristic_max_concurrency";

function readMaxJobs(phases: Record<string, unknown> | null): number {
  const discovery = phases?.["discovery"] as Record<string, unknown> | undefined;
  const v = discovery?.["max_jobs"];
  return typeof v === "number" ? v : 10;
}

function maskIfSensitive(def: VariableDef, value: VariableValue): VariableValue {
  if (def.sensitive && typeof value === "string" && value.length > 0) return "***";
  return value;
}

function buildVariableItems(row: PipelineConfigRow): VariableItem[] {
  const raw: Record<string, VariableValue> = {
    cron_enabled: row.enabled,
    cron_expression: row.cron_expression,
    max_jobs: readMaxJobs(row.phases),
    google_places_budget_total: row.google_places_budget_total,
    google_places_alert_threshold: row.google_places_alert_threshold,
    webhook_url: row.notify_webhook_url,
    webhook_secret: row.notify_webhook_secret,
    webhook_events: row.notify_webhook_events ?? [],
    max_concurrent_runs: row.max_concurrent_runs,
    max_cpu_pct: row.max_cpu_pct,
    max_ram_pct: row.max_ram_pct,
    max_enrich_threads: row.max_enrich_threads,
    fetch_timeout_ms: row.fetch_timeout_ms,
    fetch_retries: row.fetch_retries,
    enrich_heuristic_max_concurrency: row.enrich_heuristic_max_concurrency,
  };
  return VARIABLE_REGISTRY.map((def) => ({
    ...def,
    value: maskIfSensitive(def, raw[def.key] ?? null),
  }));
}

const WEBHOOK_EVENTS_SCHEMA = z.array(z.enum(["run_completed", "new_hot_leads"]));

const VALUE_VALIDATORS: Record<string, z.ZodTypeAny> = {
  cron_enabled: z.boolean(),
  cron_expression: z.string().min(5).nullable(),
  max_jobs: z.number().int().min(1).max(50),
  google_places_budget_total: z.number().positive(),
  google_places_alert_threshold: z.number().nonnegative(),
  max_concurrent_runs: z.number().int().min(1).max(8),
  max_cpu_pct: z.number().int().min(10).max(100),
  max_ram_pct: z.number().int().min(10).max(100),
  max_enrich_threads: z.number().int().min(1).max(32),
  fetch_timeout_ms: z.number().int().min(1000).max(15000),
  fetch_retries: z.number().int().min(0).max(3),
  enrich_heuristic_max_concurrency: z.number().int().min(1).max(32),
  webhook_url: z.string().url().nullable(),
  webhook_secret: z.string().min(8).nullable(),
  webhook_events: WEBHOOK_EVENTS_SCHEMA,
};

const DB_KEY_MAP: Record<string, string> = {
  cron_enabled: "enabled",
  cron_expression: "cron_expression",
  google_places_budget_total: "google_places_budget_total",
  google_places_alert_threshold: "google_places_alert_threshold",
  webhook_url: "notify_webhook_url",
  webhook_secret: "notify_webhook_secret",
  webhook_events: "notify_webhook_events",
  max_concurrent_runs: "max_concurrent_runs",
  max_cpu_pct: "max_cpu_pct",
  max_ram_pct: "max_ram_pct",
  max_enrich_threads: "max_enrich_threads",
  fetch_timeout_ms: "fetch_timeout_ms",
  fetch_retries: "fetch_retries",
  enrich_heuristic_max_concurrency: "enrich_heuristic_max_concurrency",
};

async function applyUpdate(
  db: ReturnType<typeof getDb>,
  key: string,
  value: VariableValue
): Promise<void> {
  const base: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (key === "max_jobs") {
    const { data: current, error } = await db
      .from("pipeline_config")
      .select("phases")
      .eq("id", "singleton")
      .single();
    if (error || !current) throw new Error("Config not found for max_jobs update");
    const phases = (current["phases"] as Record<string, unknown>) ?? {};
    const discovery = (phases["discovery"] as Record<string, unknown>) ?? {};
    const update = { ...base, phases: { ...phases, discovery: { ...discovery, max_jobs: value } } };
    const { error: e } = await db.from("pipeline_config").update(update).eq("id", "singleton");
    if (e) throw new Error(`Update failed: ${e.message}`);
    return;
  }

  const dbKey = DB_KEY_MAP[key];
  if (!dbKey) throw new Error(`No DB mapping for key: ${key}`);
  const update = { ...base, [dbKey]: value };
  const { error } = await db.from("pipeline_config").update(update).eq("id", "singleton");
  if (error) throw new Error(`Update failed: ${error.message}`);
}

export async function variablesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/variables", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("pipeline_config")
      .select(CONFIG_SELECT)
      .eq("id", "singleton")
      .single();

    if (error || !data) return reply.status(500).send({ error: "Config not found" });
    return reply.status(200).send({ data: buildVariableItems(data as PipelineConfigRow) });
  });

  app.patch(
    "/admin/variables/:key",
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Params: { key: string }; Body: { value: unknown } }>,
      reply
    ) => {
      const { key } = request.params;
      const def = VARIABLE_REGISTRY.find((v) => v.key === key);
      if (!def) {
        return reply.status(404).send({ error: "Variable not found", error_code: "variable_not_found" });
      }

      const bodySchema = z.object({ value: z.unknown() });
      const parsedBody = bodySchema.safeParse(request.body);
      if (!parsedBody.success) return reply.status(400).send({ error: "Invalid body" });

      const validator = VALUE_VALIDATORS[key];
      if (!validator) return reply.status(500).send({ error: "No validator for key" });

      const parsedValue = validator.safeParse(parsedBody.data.value);
      if (!parsedValue.success) {
        return reply.status(400).send({ error: "Invalid value", issues: parsedValue.error.flatten() });
      }

      const db = getDb();
      const actor = getAuthUser(request);

      const { data: current, error: readError } = await db
        .from("pipeline_config")
        .select(CONFIG_SELECT)
        .eq("id", "singleton")
        .single();
      if (readError || !current) return reply.status(500).send({ error: "Config not found" });

      const currentItems = buildVariableItems(current as PipelineConfigRow);
      const currentItem = currentItems.find((v) => v.key === key);

      await applyUpdate(db, key, parsedValue.data as VariableValue);

      await db.from("audit_log").insert({
        actor_user_id: actor.id,
        actor_role: actor.role,
        action: "variables.update",
        target_type: "pipeline_config",
        target_id: "singleton",
        diff: {
          key,
          before: def.sensitive && currentItem?.value != null ? "***" : currentItem?.value,
          after: def.sensitive && parsedValue.data != null ? "***" : parsedValue.data,
        },
        ip_address: request.ip ?? null,
        user_agent: request.headers["user-agent"] ?? null,
      });

      const { data: updated, error: updatedError } = await db
        .from("pipeline_config")
        .select(CONFIG_SELECT)
        .eq("id", "singleton")
        .single();
      if (updatedError || !updated) return reply.status(500).send({ error: "Failed to re-read config" });

      return reply.status(200).send({ data: buildVariableItems(updated as PipelineConfigRow) });
    }
  );
}
