import { execFile } from "node:child_process";
import { getDb } from "../../db/client.js";
import { buildBackupOverview, getDefaultBackupSchedulerSnapshot, type BackupOverview } from "../backups/service.js";
import { getBackupScheduler } from "../backups/runtime.js";

type PipelineConfigRow = {
  enabled: boolean;
  cron_expression: string | null;
  scheduled_for: string | null;
  last_completed_at: string | null;
  notify_webhook_url?: string | null;
  notify_webhook_events?: string[] | null;
  google_places_budget_total?: number | null;
  google_places_budget_spent?: number | null;
  google_places_alert_threshold?: number | null;
  infra_monthly_cost_usd?: number | null;
  backup_monthly_cost_usd?: number | null;
};

type PipelineRunRow = {
  id: string;
  status: string;
  triggered_by: "manual" | "cron" | "startup-recovery" | "api";
  completed_at: string | null;
  created_at: string;
  started_at?: string | null;
  dashboard_stale?: boolean | null;
  phase_results?: Record<string, { started_at?: string; completed_at?: string | null; status?: string; items_processed?: number } | undefined> | null;
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

type LlmUsageRow = {
  provider: string;
  total_tokens: number | null;
  cost_usd: number;
  created_at: string;
};

type CostRun = {
  id: string;
  stats: Record<string, unknown> | null;
  finished_at: string | null;
};

type PipelineErrorRow = {
  id: string;
  occurred_at: string;
  run_id: string | null;
  phase: string;
  source: string | null;
  lead_id: string | null;
  error_type: string;
  message: string;
  recovered: boolean;
};

type Pm2Process = {
  name?: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
  };
};

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

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

function detectProcess(processes: Pm2Process[], name: string) {
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

function parseCurrentMonth(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    start,
    end,
  };
}

function isWithinRange(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const ts = new Date(value);
  return ts >= start && ts < end;
}

function buildWindow(days: number, now = new Date()) {
  return {
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: new Date(now),
  };
}

function diffMinutes(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  return Math.max((new Date(end).getTime() - new Date(start).getTime()) / 60_000, 0);
}

async function safeBackupOverview(): Promise<BackupOverview | null> {
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

export async function buildMonitoringOverview() {
  const db = getDb();
  const dbStartedAt = Date.now();
  const performanceDays = 30;
  const currentMonth = parseCurrentMonth();
  const performanceWindow = buildWindow(performanceDays);

  const settled = await Promise.allSettled([
    db
      .from("pipeline_config")
      .select(
        "enabled, cron_expression, scheduled_for, last_completed_at, notify_webhook_url, notify_webhook_events, google_places_budget_total, google_places_budget_spent, google_places_alert_threshold, infra_monthly_cost_usd, backup_monthly_cost_usd"
      )
      .eq("id", "singleton")
      .single(),
    db
      .from("pipeline_runs")
      .select("id, status, triggered_by, completed_at, created_at, started_at, dashboard_stale, phase_results")
      .order("created_at", { ascending: false })
      .limit(50),
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
    db
      .from("llm_usage_log")
      .select("provider, total_tokens, cost_usd, created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    db
      .from("runs")
      .select("id, stats, finished_at")
      .eq("status", "completed")
      .order("finished_at", { ascending: false })
      .limit(200),
    db
      .from("pipeline_errors")
      .select("id, occurred_at, run_id, phase, source, lead_id, error_type, message, recovered")
      .order("occurred_at", { ascending: false })
      .limit(100),
    // Exact counts — appended at the END to avoid shifting existing indices
    db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "queued"),
    db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "running"),
    db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "completed"),
    db.from("discovery_jobs").select("*", { count: "exact", head: true }).eq("status", "failed"),
    // Runs activos de la tabla `runs` (enrichment/scoring/social, incluye los lanzados por terminal).
    db
      .from("runs")
      .select("id, kind, status, started_at, niche, location")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(50),
  ]);
  const dbLatency = round(diffMs(dbStartedAt, Date.now()), 1);
  const activeRunsTableRows = settled[11]?.status === "fulfilled"
    ? ((settled[11].value as { data: unknown }).data as Array<{ id: string; kind: string | null; status: string; started_at: string; niche: string | null; location: string | null }> ?? [])
    : [];

  const settled0 = settled[0].status === "fulfilled" ? settled[0].value : { data: null, error: new Error("query failed") };
  const settled1 = settled[1].status === "fulfilled" ? settled[1].value : { data: null, error: new Error("query failed") };
  const settled2 = settled[2].status === "fulfilled" ? settled[2].value : { data: null, error: new Error("query failed") };
  const settled3 = settled[3].status === "fulfilled" ? settled[3].value : { data: null, error: new Error("query failed") };
  const settled4 = settled[4].status === "fulfilled" ? settled[4].value : { data: null, error: new Error("query failed") };
  const settled5 = settled[5].status === "fulfilled" ? settled[5].value : { data: null, error: new Error("query failed") };
  const settled6 = settled[6].status === "fulfilled" ? settled[6].value : { data: null, error: new Error("query failed") };
  const countQueued    = settled[7]?.status === "fulfilled" ? (settled[7].value as { count: number | null }).count ?? 0 : 0;
  const countRunning   = settled[8]?.status === "fulfilled" ? (settled[8].value as { count: number | null }).count ?? 0 : 0;
  const countCompleted = settled[9]?.status === "fulfilled" ? (settled[9].value as { count: number | null }).count ?? 0 : 0;
  const countFailed    = settled[10]?.status === "fulfilled" ? (settled[10].value as { count: number | null }).count ?? 0 : 0;

  const configResult = settled0;
  const runsResult = settled1;
  const activeRunResult = settled2;
  const discoveryResult = settled3;
  const llmRes = settled4;
  const runCostsRes = settled5;
  const errorsRes = settled6;

  const config = (configResult.data ?? null) as PipelineConfigRow | null;
  const runsRecent = (runsResult.data ?? []) as PipelineRunRow[];
  const activeRun = (activeRunResult.data ?? null) as PipelineRunRow | null;
  const discoveryRecent = (discoveryResult.data ?? []) as DiscoveryJobRow[];
  const llmRows = ((llmRes.data ?? []) as LlmUsageRow[]).filter((row) =>
    isWithinRange(row.created_at, currentMonth.start, currentMonth.end)
  );
  const completedCostRuns = ((runCostsRes.data ?? []) as CostRun[]).filter((run) =>
    isWithinRange(run.finished_at, currentMonth.start, currentMonth.end)
  );
  const recentErrors = ((errorsRes.data ?? []) as PipelineErrorRow[]).filter((row) =>
    isWithinRange(row.occurred_at, performanceWindow.start, performanceWindow.end)
  );
  const lastRun = runsRecent[0] ?? null;

  // Lista UNIFICADA de runs activos: pipeline + enrichment/scoring/social (tabla runs,
  // incluye los lanzados por terminal) + discovery jobs en curso. El "run activo" es el más
  // nuevo y active_run_count es cuántos corren en simultáneo.
  type ActiveRun = { id: string; kind: string; status: string; started_at: string | null; label: string | null };
  const activeRunsUnified: ActiveRun[] = [];
  if (activeRun) {
    activeRunsUnified.push({ id: activeRun.id, kind: "pipeline", status: activeRun.status, started_at: activeRun.started_at ?? activeRun.created_at ?? null, label: null });
  }
  for (const r of activeRunsTableRows) {
    activeRunsUnified.push({ id: r.id, kind: r.kind ?? "enrichment", status: r.status, started_at: r.started_at, label: [r.niche, r.location].filter(Boolean).join(" · ") || null });
  }
  for (const j of discoveryRecent) {
    if (j.status === "running" || j.status === "queued") {
      activeRunsUnified.push({ id: j.id, kind: "discovery", status: j.status, started_at: j.started_at ?? j.created_at ?? null, label: [j.source, j.location].filter(Boolean).join(" · ") || null });
    }
  }
  activeRunsUnified.sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));

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
      coreProcess = normalizePm2Process(detectProcess(processes, "blindspot-core"));
      apiProcess = normalizePm2Process(detectProcess(processes, "blindspot-api"));
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

  const llmCostUsd = llmRows.reduce((sum, row) => sum + asNumber(row.cost_usd), 0);
  const googlePlacesCostUsd = completedCostRuns.reduce((sum, run) => sum + asNumber(run.stats?.["estimated_cost_usd"]), 0);
  const googlePlacesRequestCount = completedCostRuns.reduce((sum, run) => sum + asNumber(run.stats?.["places_requests"]), 0);
  const infraUsd = asNumber(config?.infra_monthly_cost_usd);
  const backupUsd = asNumber(config?.backup_monthly_cost_usd);
  const totalUsd = llmCostUsd + googlePlacesCostUsd + infraUsd + backupUsd;

  const backupOverview = await safeBackupOverview();
  const backupAlerts = backupOverview?.alerts ?? [];
  // Use exact DB counts instead of sampling the last 50 rows
  const discoverySummary = {
    queued: countQueued,
    running: countRunning,
    completed: countCompleted,
    failed: countFailed,
    paused: 0,
    cancelled: 0,
  };
  const failedDiscovery = discoveryRecent.filter((job) => job.status === "failed").slice(0, 5);
  const manualDiscovery = discoveryRecent.filter((job) => job.triggered_by === "manual").slice(0, 5);
  const llmConfig = inferLlmConfig();

  const performanceRuns = runsRecent.filter((run) => isWithinRange(run.created_at, performanceWindow.start, performanceWindow.end));
  const statusCounts = {
    total: performanceRuns.length,
    successful: performanceRuns.filter((run) => run.status === "completed").length,
    failed: performanceRuns.filter((run) => run.status === "failed").length,
    partial: performanceRuns.filter((run) => run.status === "partial").length,
    aborted: performanceRuns.filter((run) => run.status === "aborted").length,
    pending: performanceRuns.filter((run) => run.status === "pending").length,
    running: performanceRuns.filter((run) => run.status === "running").length,
  };
  const completedRuns = performanceRuns.filter((run) => run.started_at && run.completed_at);
  const totalMinutes = completedRuns.reduce((sum, run) => sum + diffMinutes(run.started_at, run.completed_at), 0);
  const avgMinutes = completedRuns.length > 0 ? totalMinutes / completedRuns.length : 0;

  let enrichItems = 0;
  let scoreItems = 0;
  let discoveryItems = 0;
  let enrichMinutes = 0;
  let scoreMinutes = 0;
  let discoveryMinutes = 0;
  for (const run of completedRuns) {
    const enrich = run.phase_results?.["enrich"];
    const score = run.phase_results?.["score"];
    const discovery = run.phase_results?.["discovery"];
    enrichItems += asNumber(enrich?.items_processed);
    scoreItems += asNumber(score?.items_processed);
    discoveryItems += asNumber(discovery?.items_processed);
    enrichMinutes += diffMinutes(enrich?.started_at ?? null, enrich?.completed_at ?? null);
    scoreMinutes += diffMinutes(score?.started_at ?? null, score?.completed_at ?? null);
    discoveryMinutes += diffMinutes(discovery?.started_at ?? null, discovery?.completed_at ?? null);
  }

  const throughput = {
    enrich_per_hour: enrichMinutes > 0 ? round((enrichItems / enrichMinutes) * 60, 2) : 0,
    score_per_hour: scoreMinutes > 0 ? round((scoreItems / scoreMinutes) * 60, 2) : 0,
    discovery_per_min: discoveryMinutes > 0 ? round(discoveryItems / discoveryMinutes, 2) : 0,
  };

  const operationalConcurrency = {
    discovery_default: 5,
    discovery_google_default: 5,
    active_pipeline_workers: activeRun ? 1 : 0,
  };

  const status =
    configResult.error ||
    backupAlerts.includes("backup_recent_failure") ||
    backupAlerts.includes("backup_scheduler_stale") ||
    backupAlerts.includes("backup_directory_invalid") ||
    cronMissed ||
    recentErrors.some((error) => !error.recovered)
      ? "degraded"
      : "ok";

  return {
    status,
    generated_at: new Date().toISOString(),
    server: {
      uptime_seconds: Math.round(process.uptime()),
      version: currentVersion(),
      node_env: process.env["NODE_ENV"] ?? "development",
      pm2_managed: process.env["NODE_ENV"] === "production",
    },
    health: {
      db_connected: !configResult.error && !runsResult.error && !discoveryResult.error,
      db_latency_ms: dbLatency,
      cron_missed: Boolean(cronMissed),
      dashboard_stale: Boolean(lastRun?.dashboard_stale),
      last_run_status: lastRun?.status ?? null,
      backup_alerts: backupAlerts,
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
    pipeline: {
      cron_enabled: config?.enabled ?? false,
      cron_expression: config?.cron_expression ?? null,
      next_run_at: config?.scheduled_for ?? null,
      last_run_at: lastRun?.completed_at ?? lastRun?.created_at ?? null,
      last_completed_at: config?.last_completed_at ?? null,
      last_status: lastRun?.status ?? null,
      active_run: activeRunsUnified[0] ?? activeRun,
      active_runs: activeRunsUnified,
      active_run_count: activeRunsUnified.length,
      recent: runsRecent.slice(0, 10),
      runs_by_trigger: summarizeRuns(runsRecent),
    },
    discovery: {
      summary: discoverySummary,
      backlog: discoverySummary.queued + discoverySummary.paused,
      recent_manual: manualDiscovery,
      recent_failed: failedDiscovery,
    },
    backups: backupOverview
      ? {
          alerts: backupAlerts,
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
    costs: {
      month: currentMonth.month,
      totals: {
        llm_usd: roundMoney(llmCostUsd),
        google_places_usd: roundMoney(googlePlacesCostUsd),
        infra_usd: roundMoney(infraUsd),
        backup_usd: roundMoney(backupUsd),
        total_usd: roundMoney(totalUsd),
      },
      google_places: {
        budget_total: config?.google_places_budget_total ?? null,
        budget_spent: config?.google_places_budget_spent ?? null,
        budget_remaining:
          config?.google_places_budget_total != null && config.google_places_budget_spent != null
            ? roundMoney(config.google_places_budget_total - config.google_places_budget_spent)
            : null,
        alert_threshold: config?.google_places_alert_threshold ?? null,
        over_alert:
          config?.google_places_budget_total != null &&
          config.google_places_budget_spent != null &&
          config.google_places_alert_threshold != null
            ? config.google_places_budget_total - config.google_places_budget_spent <= config.google_places_alert_threshold
            : false,
        request_count: googlePlacesRequestCount,
      },
    },
    performance: {
      window_days: performanceDays,
      runs: statusCounts,
      duration: {
        avg_min: round(avgMinutes, 1),
        total_hours: round(totalMinutes / 60, 2),
      },
      throughput,
      recent_errors: recentErrors.slice(0, 10),
    },
    operational: {
      llm: llmConfig,
      webhook: {
        configured: Boolean(config?.notify_webhook_url),
        events: config?.notify_webhook_events ?? [],
      },
      concurrency: operationalConcurrency,
    },
    logs: {
      recent: recentErrors.slice(0, 10),
    },
  };
}
