import { execFile } from "node:child_process";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getDb } from "../../db/client.js";
import { getAuthUser, requireAdmin } from "../../auth/middleware.js";
import { buildBackupOverview, getDefaultBackupSchedulerSnapshot } from "../../modules/backups/service.js";
import { getBackupScheduler } from "../../modules/backups/runtime.js";

type PipelineConfigRow = {
  enabled: boolean;
  cron_expression: string | null;
  scheduled_for: string | null;
  last_completed_at: string | null;
  notify_webhook_url?: string | null;
  notify_webhook_events?: string[] | null;
};

type PipelineRunRow = {
  id: string;
  status: string;
  triggered_by: "manual" | "cron" | "startup-recovery" | "api";
  completed_at: string | null;
  created_at: string;
  started_at?: string | null;
  dashboard_stale?: boolean | null;
};

type DiscoveryJobRow = {
  id: string;
  source: string;
  location: string;
  niche: string | null;
  profile: string | null;
  status: string;
  triggered_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

type Pm2Process = {
  name?: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
  };
};

type RestartErrorCode =
  | "restart_disabled_in_dev"
  | "pm2_not_found"
  | "process_not_registered"
  | "pm2_failed"
  | "timeout";

type ProcessSnapshot = {
  running: boolean;
  pid: number | null;
  uptime_seconds: number | null;
  status: string;
};

function diffMs(left: number, right: number): number {
  return Math.max(right - left, 0);
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function currentVersion(): string {
  return process.env["npm_package_version"] ?? "unknown";
}

function normalizePm2Process(entry: Pm2Process | null | undefined): ProcessSnapshot {
  const running = entry?.pm2_env?.status === "online";
  const pmUptime = entry?.pm2_env?.pm_uptime;
  return {
    running,
    pid: typeof entry?.pid === "number" && entry.pid > 0 ? entry.pid : null,
    uptime_seconds:
      typeof pmUptime === "number"
        ? Math.max(Math.round((Date.now() - pmUptime) / 1000), 0)
        : null,
    status: entry?.pm2_env?.status ?? (running ? "online" : "offline"),
  };
}

function detectProcess(processes: Pm2Process[], name: "core" | "api") {
  return processes.find((entry) => entry.name === name) ?? null;
}

function execPm2(args: string[], timeout = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("pm2", args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function listPm2Processes(): Promise<Pm2Process[]> {
  const { stdout } = await execPm2(["jlist"]);
  const parsed = JSON.parse(stdout) as unknown;
  return Array.isArray(parsed) ? (parsed as Pm2Process[]) : [];
}

function restartErrorReply(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  status: number,
  error_code: RestartErrorCode,
  error: string,
  stderr = "",
  exit_code: number | null = null
) {
  return reply.status(status).send({
    ok: false,
    error,
    error_code,
    stderr,
    exit_code,
  });
}

async function writeAuditLog(
  request: FastifyRequest,
  targetId: "core" | "api",
  beforeStatus: ProcessSnapshot | null
): Promise<void> {
  const db = getDb();
  const actor = getAuthUser(request);
  await db.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_role: actor.role,
    action: "system.restart",
    target_type: "system",
    target_id: targetId,
    diff: {
      requested_by_user_id: actor.id,
      before_status: beforeStatus,
      requested_at: new Date().toISOString(),
    },
    ip_address: request.ip ?? null,
    user_agent: request.headers["user-agent"] ?? null,
  });
}

function inferLlmConfig() {
  const provider = process.env["LLM_PROVIDER"] ?? "template";
  const model = process.env["LLM_MODEL"] ?? null;
  const keyConfigured = Boolean(
    process.env["GEMINI_API_KEY"] ??
      process.env["GOOGLE_GEMINI_API_KEY"] ??
      process.env["OPENAI_COMPAT_API_KEY"] ??
      process.env["OLLAMA_BASE_URL"]
  );

  return {
    provider_active: provider,
    model,
    key_configured: keyConfigured,
  };
}

function summarizeRuns(rows: PipelineRunRow[]) {
  const byTrigger = {
    manual: { total: 0, last_status: null as string | null, last_run_at: null as string | null },
    cron: { total: 0, last_status: null as string | null, last_run_at: null as string | null },
    "startup-recovery": { total: 0, last_status: null as string | null, last_run_at: null as string | null },
    api: { total: 0, last_status: null as string | null, last_run_at: null as string | null },
  };

  for (const row of rows) {
    const bucket = byTrigger[row.triggered_by];
    if (!bucket) continue;
    bucket.total += 1;
    if (!bucket.last_run_at) {
      bucket.last_run_at = row.created_at;
      bucket.last_status = row.status;
    }
  }

  return byTrigger;
}

async function safeBackupOverview() {
  try {
    return await buildBackupOverview(getBackupScheduler().getSnapshot());
  } catch {
    try {
      return await buildBackupOverview(getDefaultBackupSchedulerSnapshot());
    } catch {
      return null;
    }
  }
}

function summarizeDiscovery(rows: DiscoveryJobRow[]) {
  const counts = {
    queued: 0,
    running: 0,
    failed: 0,
    completed: 0,
    paused: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] += 1;
    }
  }

  return counts;
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/system/status", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const dbStartedAt = Date.now();
    const [configResult, runsResult, activeRunResult, discoveryResult] = await Promise.all([
      db
        .from("pipeline_config")
        .select("enabled, cron_expression, scheduled_for, last_completed_at, notify_webhook_url, notify_webhook_events")
        .eq("id", "singleton")
        .single(),
      db
        .from("pipeline_runs")
        .select("id, status, triggered_by, completed_at, created_at, started_at, dashboard_stale")
        .order("created_at", { ascending: false })
        .limit(25),
      db
        .from("pipeline_runs")
        .select("id, status, triggered_by, completed_at, created_at, started_at, dashboard_stale")
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("discovery_jobs")
        .select("id, source, location, niche, profile, status, triggered_by, created_at, started_at, completed_at, error_message")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const dbLatency = round(diffMs(dbStartedAt, Date.now()), 1);

    const config = (configResult.data ?? null) as PipelineConfigRow | null;
    const runsRecent = (runsResult.data ?? []) as PipelineRunRow[];
    const activeRun = (activeRunResult.data ?? null) as PipelineRunRow | null;
    const discoveryRecent = (discoveryResult.data ?? []) as DiscoveryJobRow[];
    const lastRun = runsRecent[0] ?? null;

    const cronMissed =
      config?.enabled &&
      config.scheduled_for &&
      new Date(config.scheduled_for).getTime() < Date.now() - 15 * 60 * 1000 &&
      (!config.last_completed_at || new Date(config.last_completed_at) < new Date(config.scheduled_for));

    let coreProcess: ProcessSnapshot = {
      running: false,
      pid: null,
      uptime_seconds: null,
      status: "unavailable",
    };
    let apiProcess: ProcessSnapshot = {
      running: true,
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      status: process.env["NODE_ENV"] === "production" ? "online" : "dev",
    };

    if (process.env["NODE_ENV"] === "production") {
      try {
        const processes = await listPm2Processes();
        coreProcess = normalizePm2Process(detectProcess(processes, "core"));
        apiProcess = normalizePm2Process(detectProcess(processes, "api"));
      } catch {
        coreProcess = {
          running: false,
          pid: null,
          uptime_seconds: null,
          status: "pm2_unavailable",
        };
        apiProcess = {
          running: apiProcess.running,
          pid: apiProcess.pid,
          uptime_seconds: apiProcess.uptime_seconds,
          status: "pm2_unavailable",
        };
      }
    }

    const discoverySummary = summarizeDiscovery(discoveryRecent);
    const failedDiscovery = discoveryRecent.filter((job) => job.status === "failed").slice(0, 5);
    const manualDiscovery = discoveryRecent.filter((job) => job.triggered_by === "manual").slice(0, 5);
    const llmConfig = inferLlmConfig();
    const backupOverview = await safeBackupOverview();
    const backupAlerts = backupOverview?.alerts ?? [];

    return reply.status(200).send({
      data: {
        status: configResult.error || (backupAlerts.includes("backup_recent_failure") || backupAlerts.includes("backup_scheduler_stale") || backupAlerts.includes("backup_directory_invalid")) ? "degraded" : "ok",
        server: {
          uptime_seconds: Math.round(process.uptime()),
          version: currentVersion(),
        },
        db: {
          connected: !configResult.error && !runsResult.error && !discoveryResult.error,
          latency_ms: dbLatency,
        },
        pipeline: {
          cron_enabled: config?.enabled ?? false,
          cron_expression: config?.cron_expression ?? null,
          next_run_at: config?.scheduled_for ?? null,
          last_run_at: lastRun?.completed_at ?? lastRun?.created_at ?? null,
          last_status: lastRun?.status ?? null,
          missed: cronMissed ?? false,
          active_run: activeRun,
          runs_recent: summarizeRuns(runsRecent),
          recent: runsRecent,
        },
        processes: {
          api: apiProcess,
          core: coreProcess,
          db: {
            running: !configResult.error,
            pid: null,
            uptime_seconds: null,
            status: !configResult.error ? "connected" : "error",
          },
        },
        last_run: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              completed_at: lastRun.completed_at,
              dashboard_stale: Boolean(lastRun.dashboard_stale),
            }
          : null,
        cron: {
          enabled: config?.enabled ?? false,
          scheduled_for: config?.scheduled_for ?? null,
          last_completed_at: config?.last_completed_at ?? null,
          missed: cronMissed ?? false,
        },
        discovery: {
          summary: discoverySummary,
          backlog: discoverySummary.queued + discoverySummary.paused,
          recent_manual: manualDiscovery,
          recent_failed: failedDiscovery,
          recent: discoveryRecent,
        },
        integrations: {
          ai: llmConfig,
          webhook: {
            configured: Boolean(config?.notify_webhook_url),
            events: config?.notify_webhook_events ?? [],
            url: config?.notify_webhook_url ?? null,
          },
        },
        backups: backupOverview
          ? {
              scheduler: backupOverview.scheduler,
              config: {
                enabled: backupOverview.config.enabled,
                cron_expression: backupOverview.config.cron_expression,
                next_backup_at: backupOverview.summary.next_backup_at,
                directory: backupOverview.config.effective_directory,
                directory_valid: backupOverview.config.directory_valid,
                max_backups: backupOverview.summary.max_backups,
                max_manual_backups: backupOverview.config.max_manual_backups,
                max_scheduled_backups: backupOverview.config.max_scheduled_backups,
                maintenance_mode: backupOverview.config.maintenance_mode,
              },
              summary: backupOverview.summary,
              restore: backupOverview.restore,
              recent: backupOverview.recent.slice(0, 10),
            }
          : null,
        alerts: [
          cronMissed ? "pipeline_cron_missed" : null,
          activeRun?.status === "running" ? "pipeline_run_in_progress" : null,
          failedDiscovery.length > 0 ? "discovery_failures_present" : null,
          ...backupAlerts,
        ].filter((value): value is string => value !== null),
        ts: new Date().toISOString(),
      },
    });
  });

  const restartProcess = (target: "core" | "api") =>
    async (request: FastifyRequest, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
      if (process.env["NODE_ENV"] !== "production") {
        return restartErrorReply(reply, 501, "restart_disabled_in_dev", "Restart disabled in dev");
      }

      let beforeProcesses: Pm2Process[];
      try {
        beforeProcesses = await listPm2Processes();
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
          return restartErrorReply(reply, 503, "pm2_not_found", "pm2 not found", stderr);
        }
        return restartErrorReply(reply, 500, "pm2_failed", "Unable to inspect pm2 state", stderr);
      }

      const beforeProcess = detectProcess(beforeProcesses, target);
      if (!beforeProcess) {
        return restartErrorReply(reply, 503, "process_not_registered", `Process ${target} not registered in pm2`);
      }

      await writeAuditLog(request, target, normalizePm2Process(beforeProcess));

      try {
        await execPm2(["restart", target], 30_000);
        return reply.status(200).send({ ok: true, exit_code: 0 });
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
        const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
        const exitCode =
          error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : null;
        const combined = `${stdout}\n${stderr}`.toLowerCase();

        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
          return restartErrorReply(reply, 503, "pm2_not_found", "pm2 not found", stderr, exitCode);
        }

        if (combined.includes("process or namespace") || combined.includes("not found")) {
          return restartErrorReply(reply, 503, "process_not_registered", `Process ${target} not registered in pm2`, stderr, exitCode);
        }

        if (error && typeof error === "object" && "killed" in error && (error as { killed?: boolean }).killed) {
          return restartErrorReply(reply, 504, "timeout", "pm2 restart timed out", stderr, exitCode);
        }

        return restartErrorReply(reply, 500, "pm2_failed", "pm2 restart failed", stderr, exitCode);
      }
    };

  app.post("/admin/system/restart-core", { preHandler: requireAdmin }, restartProcess("core"));
  app.post("/admin/system/restart-api", { preHandler: requireAdmin }, restartProcess("api"));
}
