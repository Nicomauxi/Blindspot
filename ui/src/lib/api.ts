function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    // In the browser, prefer same-origin requests so Next rewrites can absorb
    // local LAN/IP differences without tripping CORS.
    return "";
  }

  return process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public error_code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (options.body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${resolveBaseUrl()}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { error_code?: string }).error_code ?? "unknown_error",
      (body as { error?: string }).error ?? `HTTP ${res.status}`
    );
  }
  return body as T;
}

export type PaginatedResponse<T> = {
  data: T[];
  next_cursor: string | null;
  total: number;
};

export type SingleResponse<T> = { data: T };

// Auth
export async function login(email: string, password: string) {
  return request<{ token: string; role: "admin" | "cm" }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshToken(token: string) {
  return request<{ token: string }>("/auth/refresh", { method: "POST" }, token);
}

// Users
export type User = {
  id: string;
  email: string;
  role: "admin" | "cm";
  lead_filter: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export async function listUsers(token: string, cursor?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request<PaginatedResponse<User>>(`/api/v1/users?${params}`, {}, token);
}

export async function createUser(
  token: string,
  data: {
    email: string;
    password: string;
    role: "admin" | "cm";
    lead_filter?: Record<string, unknown> | null;
    acknowledge_unrestricted?: boolean;
  }
) {
  return request<SingleResponse<User>>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export async function patchUser(
  token: string,
  id: string,
  data: Partial<{
    email: string;
    password: string;
    active: boolean;
    role: "admin" | "cm";
    lead_filter: Record<string, unknown> | null;
    acknowledge_unrestricted: boolean;
  }>
) {
  return request<SingleResponse<User>>(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }, token);
}

export async function deleteUser(token: string, id: string) {
  return request<void>(`/api/v1/users/${id}`, { method: "DELETE" }, token);
}

// Health
export type HealthStatus = {
  status: "ok" | "degraded";
  db: "connected" | "error";
  last_run: {
    id: string;
    status: string;
    completed_at: string | null;
    dashboard_stale: boolean;
  } | null;
  cron: {
    enabled: boolean;
    scheduled_for: string | null;
    last_completed_at: string | null;
    missed: boolean;
  };
  backups: {
    last_backup: BackupRun | null;
    next_backup_at: string | null;
    scheduler: BackupSchedulerState;
    directory: string;
    directory_valid: boolean;
    count: number;
    max_backups: number;
    retention: {
      manual: { count: number; max: number };
      scheduled: { count: number; max: number };
    };
    manual_backup_count: number;
    scheduled_backup_count: number;
    restore_checkpoint_count: number;
    alerts: string[];
    maintenance_mode: boolean;
    last_restore: BackupRestoreRun | null;
    restore: BackupOverview["restore"];
  } | null;
  ts: string;
};

export async function getHealth(token: string) {
  return request<HealthStatus>("/api/v1/health", {}, token);
}

export type AdminSystemStatus = {
  status: "ok" | "degraded";
  server: {
    uptime_seconds: number;
    version: string;
  };
  db: {
    connected: boolean;
    latency_ms: number;
  };
  pipeline: {
    cron_enabled: boolean;
    cron_expression: string | null;
    next_run_at: string | null;
    last_run_at: string | null;
    last_status: string | null;
    missed: boolean;
    active_run: PipelineRun | null;
    active_runs?: Array<{ id: string; kind: string; status: string; started_at: string | null; label: string | null }>;
    active_run_count?: number;
    runs_recent: Record<string, { total: number; last_status: string | null; last_run_at: string | null }>;
    recent: PipelineRun[];
  };
  processes: {
    core: {
      running: boolean;
      pid: number | null;
      uptime_seconds: number | null;
      status: string;
    };
    api: {
      running: boolean;
      pid: number | null;
      uptime_seconds: number | null;
      status: string;
    };
    db: {
      running: boolean;
      pid: number | null;
      uptime_seconds: number | null;
      status: string;
    };
  };
  last_run: {
    id: string;
    status: string;
    completed_at: string | null;
    dashboard_stale: boolean;
  } | null;
  cron: {
    enabled: boolean;
    scheduled_for: string | null;
    last_completed_at: string | null;
    missed: boolean;
  };
  discovery: {
    summary: Record<string, number>;
    backlog: number;
    recent_manual: DiscoveryJob[];
    recent_failed: DiscoveryJob[];
    recent: DiscoveryJob[];
  };
  integrations: {
    ai: {
      provider_active: string;
      model: string | null;
      key_configured: boolean;
    };
    webhook: {
      configured: boolean;
      events: string[];
      url: string | null;
    };
  };
  backups: {
    scheduler: BackupSchedulerState;
    config: {
      enabled: boolean;
      cron_expression: string;
      next_backup_at: string | null;
      directory: string;
      directory_valid: boolean;
      max_backups: number;
      max_manual_backups: number;
      max_scheduled_backups: number;
    };
    summary: BackupOverview["summary"];
    recent: BackupRun[];
  } | null;
  alerts: string[];
  ts: string;
};

export type RestartResponse =
  | { ok: true; exit_code: 0 }
  | {
      ok: false;
      error_code:
        | "restart_disabled_in_dev"
        | "pm2_not_found"
        | "process_not_registered"
        | "pm2_failed"
        | "timeout";
      error: string;
      stderr: string;
      exit_code: number | null;
    };

export async function getSystemStatus(token: string) {
  return request<{ data: AdminSystemStatus }>("/api/v1/admin/system/status", {}, token);
}

export async function restartSystemProcess(token: string, target: "core" | "api") {
  return request<RestartResponse>(`/api/v1/admin/system/restart-${target}`, { method: "POST" }, token);
}

export async function restartAll(token: string) {
  return request<RestartResponse>("/api/v1/admin/system/restart", { method: "POST", body: JSON.stringify({ target: "all" }) }, token);
}

export async function resetDatabase(token: string) {
  return request<{ ok: boolean; output?: string }>("/api/v1/admin/system/reset-db", { method: "POST", body: JSON.stringify({ confirm: true }) }, token);
}

export type MonitoringOverview = {
  status: "ok" | "degraded";
  generated_at: string;
  server: {
    uptime_seconds: number;
    version: string;
    node_env: string;
    pm2_managed: boolean;
  };
  health: {
    db_connected: boolean;
    db_latency_ms: number;
    cron_missed: boolean;
    dashboard_stale: boolean;
    last_run_status: string | null;
    backup_alerts: string[];
  };
  processes: AdminSystemStatus["processes"];
  pipeline: {
    cron_enabled: boolean;
    cron_expression: string | null;
    next_run_at: string | null;
    last_run_at: string | null;
    last_completed_at: string | null;
    last_status: string | null;
    active_run: PipelineRun | null;
    active_runs?: Array<{ id: string; kind: string; status: string; started_at: string | null; label: string | null }>;
    active_run_count?: number;
    recent: PipelineRun[];
    runs_by_trigger: Record<string, { total: number; last_status: string | null; last_run_at: string | null }>;
  };
  discovery: {
    summary: Record<string, number>;
    backlog: number;
    recent_manual: DiscoveryJob[];
    recent_failed: DiscoveryJob[];
  };
  backups: {
    alerts: string[];
    scheduler: BackupSchedulerState;
    config: {
      enabled: boolean;
      cron_expression: string;
      next_backup_at: string | null;
      directory: string;
      directory_valid: boolean;
      max_backups: number;
      max_manual_backups: number;
      max_scheduled_backups: number;
      maintenance_mode: boolean;
    };
    summary: BackupOverview["summary"];
    restore: BackupOverview["restore"];
    recent: BackupRun[];
  } | null;
  costs: {
    month: string;
    totals: {
      llm_usd: number;
      google_places_usd: number;
      infra_usd: number;
      backup_usd: number;
      total_usd: number;
    };
    google_places: {
      budget_total: number | null;
      budget_spent: number | null;
      budget_remaining: number | null;
      alert_threshold: number | null;
      over_alert: boolean;
      request_count: number;
    };
  };
  performance: {
    window_days: number;
    runs: {
      total: number;
      successful: number;
      failed: number;
      partial: number;
      aborted: number;
      pending: number;
      running: number;
    };
    duration: {
      avg_min: number;
      total_hours: number;
    };
    throughput: {
      enrich_per_hour: number;
      score_per_hour: number;
      discovery_per_min: number;
    };
    recent_errors: Array<{
      id: string;
      occurred_at: string;
      run_id: string | null;
      phase: string;
      source: string | null;
      lead_id: string | null;
      error_type: string;
      message: string;
      recovered: boolean;
    }>;
  };
  operational: {
    llm: {
      provider_active: string;
      model: string | null;
      key_configured: boolean;
    };
    webhook: {
      configured: boolean;
      events: string[];
      url: string | null;
    };
    concurrency: {
      discovery_default: number;
      discovery_google_default: number;
      active_pipeline_workers: number;
    };
  };
  logs: {
    recent: Array<{
      id: string;
      occurred_at: string;
      run_id: string | null;
      phase: string;
      source: string | null;
      lead_id: string | null;
      error_type: string;
      message: string;
      recovered: boolean;
    }>;
  };
};

export async function getMonitoringOverview(token: string) {
  return request<{ data: MonitoringOverview }>("/api/v1/admin/monitoring/overview", {}, token);
}

export type DiscoveryJobSummaryRow = {
  id: string;
  source: string;
  location: string;
  niche: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
};

export type DiscoveryJobsSummary = {
  counts: Record<string, number>;
  by_status: Record<string, DiscoveryJobSummaryRow[]>;
};

export async function getMonitoringDiscoveryJobs(token: string) {
  return request<{ data: DiscoveryJobsSummary }>("/api/v1/admin/monitoring/discovery-jobs", {}, token);
}

export type UnifiedRunKind = "pipeline" | "enrichment" | "scoring" | "social" | "discovery";

export type UnifiedRun = {
  id: string;
  kind: UnifiedRunKind | string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  label: string | null;
  source_run_id: string | null;
  progress: Record<string, unknown> | null;
  phases: unknown;
};

export type SocialEnrichJobState = {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  log_file: string | null;
  limit: number | null;
  force: boolean | null;
};

export async function getSocialEnrichJob(token: string) {
  return request<{ data: SocialEnrichJobState }>("/api/v1/admin/social-enrich/jobs/current", {}, token);
}

export async function launchSocialEnrichJob(token: string, body: { limit?: number; force?: boolean }) {
  return request<{ data: SocialEnrichJobState }>(
    "/api/v1/admin/social-enrich/jobs",
    { method: "POST", body: JSON.stringify(body) },
    token
  );
}

export async function listMonitoringRuns(
  token: string,
  opts: { type?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<{ data: UnifiedRun[] }>(`/api/v1/admin/monitoring/runs${qs ? `?${qs}` : ""}`, {}, token);
}

export type BackupRun = {
  id: string;
  trigger: "manual" | "scheduled";
  purpose: "standard" | "restore_checkpoint";
  status: "running" | "completed" | "failed";
  path: string | null;
  filename: string | null;
  created_at: string;
  completed_at: string | null;
  size_bytes: number | null;
  error_message: string | null;
  cleanup_deleted_count: number;
  cleanup_error_message: string | null;
  deleted_at: string | null;
};

export type BackupSchedulerState = {
  started: boolean;
  cron_active: boolean;
  status: "stopped" | "idle" | "scheduled" | "invalid_cron" | "running" | "error" | "maintenance";
  last_reload_at: string | null;
  last_tick_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
};

export type BackupRestoreRun = {
  id: string;
  backup_run_id: string | null;
  checkpoint_backup_run_id: string | null;
  status: "running" | "completed" | "failed";
  backup_path: string | null;
  backup_filename: string | null;
  checkpoint_path: string | null;
  checkpoint_filename: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  triggered_by_user_id: string | null;
  maintenance_started_at: string | null;
  maintenance_finished_at: string | null;
};

export type BackupOverview = {
  config: {
    id: "singleton";
    updated_at: string;
    enabled: boolean;
    cron_expression: string;
    scheduled_for: string | null;
    directory: string | null;
    effective_directory: string;
    directory_valid: boolean;
    directory_error: string | null;
    max_backups: number;
    max_manual_backups: number;
    max_scheduled_backups: number;
    last_started_at: string | null;
    last_completed_at: string | null;
    last_successful_at: string | null;
    last_error_at: string | null;
    last_error_message: string | null;
    scheduler_heartbeat_at: string | null;
    maintenance_mode: boolean;
    maintenance_started_at: string | null;
    restore_started_at: string | null;
    restore_completed_at: string | null;
    restore_error_at: string | null;
    restore_error_message: string | null;
  };
  scheduler: BackupSchedulerState;
  summary: {
    last_backup: BackupRun | null;
    next_backup_at: string | null;
    backup_count: number;
    max_backups: number;
    manual_backup_count: number;
    scheduled_backup_count: number;
    restore_checkpoint_count: number;
    retention: {
      manual: { count: number; max: number };
      scheduled: { count: number; max: number };
    };
    database_size_bytes: number | null;
    stored_backup_size_bytes: number;
    stored_backup_size_by_trigger: {
      manual: number;
      scheduled: number;
    };
    last_restore: BackupRestoreRun | null;
  };
  restore: {
    active: {
      status: "running" | "completed" | "failed";
      backup_run_id: string;
      backup_filename: string | null;
      checkpoint_backup_run_id: string | null;
      checkpoint_filename: string | null;
      started_at: string;
      maintenance_started_at: string;
      completed_at: string | null;
      error_message: string | null;
      triggered_by_user_id: string | null;
    } | null;
    last_restore: BackupRestoreRun | null;
  };
  alerts: string[];
  recent: BackupRun[];
};

export async function getBackupsOverview(token: string) {
  return request<{ data: BackupOverview }>("/api/v1/admin/backups", {}, token);
}

export async function patchBackupConfig(
  token: string,
  data: Partial<{
    enabled: boolean;
    cron_expression: string;
    directory: string | null;
    max_backups: number;
    max_manual_backups: number;
    max_scheduled_backups: number;
  }>
) {
  return request<{ data: { config: BackupOverview["config"]; overview: BackupOverview } }>("/api/v1/admin/backups/config", {
    method: "PATCH",
    body: JSON.stringify(data),
  }, token);
}

export async function runBackupNow(token: string) {
  return request<{ data: BackupRun }>("/api/v1/admin/backups/run", { method: "POST" }, token);
}

export async function restoreBackupById(token: string, id: string) {
  return request<{ data: BackupRestoreRun }>(`/api/v1/admin/backups/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ confirmation: "RESTORE" }),
  }, token);
}

export async function deleteBackupById(token: string, id: string) {
  return request<{ data: { id: string; deleted_at: string } }>(`/api/v1/admin/backups/${id}`, { method: "DELETE" }, token);
}

// Audit log
export type AuditLogEntry = {
  id: string;
  occurred_at: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  diff: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
};

// Pipeline config
export type PipelineConfig = {
  id: string;
  enabled: boolean;
  cron_expression: string | null;
  scheduled_for: string | null;
  last_completed_at: string | null;
  cpu_budget: "conservative" | "balanced" | "aggressive" | null;
  phases: Record<string, unknown> | null;
  notify_webhook_url: string | null;
  notify_webhook_secret: string | null;
  notify_webhook_events: string[];
  updated_at: string;
};

export async function getPipelineConfig(token: string) {
  return request<SingleResponse<PipelineConfig>>("/api/v1/pipeline/config", {}, token);
}

export type VariableItem = {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "string" | "string_array";
  sensitive: boolean;
  nullable: boolean;
  group: "resources" | "pipeline";
  value: boolean | number | string | string[] | null;
};

export async function getAdminVariables(token: string) {
  return request<{ data: VariableItem[] }>("/api/v1/admin/variables", {}, token);
}

export async function patchAdminVariable(
  token: string,
  key: string,
  value: boolean | number | string | string[] | null
) {
  return request<{ data: VariableItem[] }>(
    `/api/v1/admin/variables/${encodeURIComponent(key)}`,
    { method: "PATCH", body: JSON.stringify({ value }) },
    token
  );
}

export type ProcessMetricSnapshot = {
  process: string;
  cpu_pct: number | null;
  mem_bytes: number | null;
  uptime_seconds: number;
  recorded_at: string;
};

export type ProcessMetricsData = {
  current: ProcessMetricSnapshot[];
  history: ProcessMetricSnapshot[];
};

export async function getProcessMetrics(token: string) {
  return request<{ data: ProcessMetricsData }>("/api/v1/admin/operations/process-metrics", {}, token);
}

// ── Embedded scheduler control ──────────────────────────────────────────────

export type SchedulerStatus = "running" | "stopped" | "disabled";

export type SchedulerStatusData = {
  status: SchedulerStatus;
  uptime_seconds: number | null;
  embedded: boolean;
};

export type SchedulerLogLine = {
  ts: string;
  level: string;
  msg: string;
};

export async function getSchedulerStatus(token: string) {
  return request<{ data: SchedulerStatusData }>("/api/v1/admin/scheduler/status", {}, token);
}

export async function startScheduler(token: string) {
  return request<{ data: { status: string } }>("/api/v1/admin/scheduler/start", { method: "POST" }, token);
}

export async function restartScheduler(token: string) {
  return request<{ data: { status: string } }>("/api/v1/admin/scheduler/restart", { method: "POST" }, token);
}

export async function getSchedulerLogs(token: string, limit = 200) {
  return request<{ data: SchedulerLogLine[] }>(
    `/api/v1/admin/scheduler/logs?limit=${limit}`,
    {},
    token
  );
}

export async function getApiLogs(token: string, limit = 200) {
  return request<{ data: SchedulerLogLine[] }>(
    `/api/v1/admin/scheduler/api-logs?limit=${limit}`,
    {},
    token
  );
}

export type MissingFilters = {
  missing_gps?: boolean;
  missing_address?: boolean;
  missing_phone?: boolean;
  missing_whatsapp?: boolean;
  missing_email?: boolean;
  missing_website?: boolean;
};

export type EnrichmentFilters = MissingFilters & {
  contact_tier?: string;
  prospect_score_gte?: number;
  niche?: string;
  source?: string;
  primary_offer?: string;
  q?: string;
  mode?: "enrichment" | "re_discovery";
  with_heuristic?: boolean;
  concurrency?: number;
  scope?: "selection" | "all";
  force_refresh?: boolean;
  rescore_on_complete?: boolean;
};

export async function estimateEnrichmentImpact(token: string, filters: Omit<EnrichmentFilters, "with_heuristic" | "concurrency">) {
  return request<{ data: { lead_count: number } }>(
    "/api/v1/admin/enrichment/filter-jobs/estimate",
    { method: "POST", body: JSON.stringify(filters) },
    token
  );
}

export async function createFilteredEnrichmentJob(
  token: string,
  filters: EnrichmentFilters
) {
  return request<{ data: { lead_count: number; run_id: string } }>(
    "/api/v1/admin/enrichment/filter-jobs",
    { method: "POST", body: JSON.stringify(filters) },
    token
  );
}

export type GpBudgetStatus = {
  budget_total: number;
  budget_spent: number;
  budget_remaining: number;
  alert_threshold: number;
  over_alert: boolean;
};

export async function getGpBudget(token: string) {
  return request<{ data: GpBudgetStatus }>("/api/v1/pipeline/gp-budget", {}, token);
}

export async function updateGpBudget(token: string, data: { budget_total?: number; alert_threshold?: number }) {
  return request<{ data: GpBudgetStatus }>("/api/v1/pipeline/gp-budget", { method: "PUT", body: JSON.stringify(data) }, token);
}

export async function resetGpBudgetSpent(token: string) {
  return request<{ data: GpBudgetStatus }>("/api/v1/pipeline/gp-budget/reset-spent", { method: "POST" }, token);
}

export async function updateMaxJobs(token: string, max_jobs: number) {
  return request<{ data: { max_jobs: number } }>("/api/v1/pipeline/config/max-jobs", { method: "PUT", body: JSON.stringify({ max_jobs }) }, token);
}

export async function updateCpuBudget(token: string, cpu_budget: "conservative" | "balanced" | "aggressive") {
  return request<{ data: { cpu_budget: string } }>("/api/v1/pipeline/config/cpu-budget", { method: "PUT", body: JSON.stringify({ cpu_budget }) }, token);
}

export type SystemAlertSeverity = "info" | "warn" | "critical";
export type SystemAlertStatus = "pending" | "read" | "archived";

export type SystemAlert = {
  id: string;
  kind: string;
  severity: SystemAlertSeverity;
  title: string;
  description: string;
  payload: Record<string, unknown> | null;
  target_user_id: string | null;
  status: SystemAlertStatus;
  created_at: string;
  read_at: string | null;
  read_by: string | null;
  dedup_key: string | null;
};

export async function listAlerts(token: string, params: { status?: SystemAlertStatus; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: SystemAlert[] }>(`/api/v1/alerts${query}`, {}, token);
}

export async function getAlertsUnreadCount(token: string) {
  return request<{ data: { count: number } }>("/api/v1/alerts/unread-count", {}, token);
}

export async function markAlertRead(token: string, alertId: string) {
  return request<{ data: { id: string; status: string } }>(`/api/v1/alerts/${alertId}/read`, { method: "POST" }, token);
}

export async function archiveAlert(token: string, alertId: string) {
  return request<{ data: { id: string; status: string } }>(`/api/v1/alerts/${alertId}/archive`, { method: "POST" }, token);
}

export async function patchPipelineConfig(
  token: string,
  data: Partial<{
    enabled: boolean;
    cron_expression: string;
    notify_webhook_url: string | null;
    notify_webhook_secret: string | null;
    notify_webhook_events: ("run_completed" | "new_hot_leads")[];
  }>
) {
  return request<SingleResponse<PipelineConfig>>("/api/v1/pipeline/config", {
    method: "PATCH",
    body: JSON.stringify(data),
  }, token);
}

export type PipelineRun = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "partial" | "aborted";
  triggered_by: "manual" | "cron" | "startup-recovery" | "api";
  overrides: {
    dry_run?: boolean;
    phases?: string[];
  } | null;
  dashboard_stale: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  phase_results: Record<string, unknown> | null;
};

export type PipelineLogLine = {
  ts?: string;
  level?: string;
  msg?: string;
  phase?: string;
  [key: string]: unknown;
};

export async function triggerPipelineRun(token: string, dryRun = false) {
  return request<SingleResponse<{ run_id: string; dry_run: boolean }>>(
    "/api/v1/pipeline/run",
    {
      method: "POST",
      body: JSON.stringify(dryRun ? { dry_run: true } : {}),
    },
    token
  );
}

export async function abortPipelineRun(token: string) {
  return request<{ data: { run_id: string; abort_requested: boolean } }>("/api/v1/pipeline/abort", { method: "POST" }, token);
}

export async function listPipelineRuns(token: string, params: { status?: string; cursor?: string; limit?: number } = {}) {
  const qp = new URLSearchParams();
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<PipelineRun>>(`/api/v1/pipeline/runs?${qp}`, {}, token);
}

export async function getPipelineRun(token: string, runId: string) {
  return request<SingleResponse<PipelineRun>>(`/api/v1/pipeline/runs/${runId}`, {}, token);
}

export async function getPipelineRunLog(token: string, runId: string, since?: string) {
  const qp = new URLSearchParams();
  if (since) qp.set("since", since);
  const suffix = qp.toString() ? `?${qp.toString()}` : "";
  return request<{ data: PipelineLogLine[] }>(`/api/v1/pipeline/runs/${runId}/log${suffix}`, {}, token);
}

export async function testWebhook(token: string) {
  return request<SingleResponse<{ status: string; http_status?: number; url: string; error?: string }>>(
    "/api/v1/pipeline/webhook/test",
    { method: "POST" },
    token
  );
}

// Leads
export type LeadFieldEvidence = {
  source: string;
  label: string;
  external_id: string | null;
  confidence: number | null;
  role: "primary" | "confirming" | "derived";
  note: string | null;
};

export type LeadFieldSource = {
  label: string;
  value: string | number | boolean | null;
  source: string | null;
  confidence: number | null;
  confirmations: number;
  evidence: LeadFieldEvidence[];
};

export type CommercialEvidenceNode = {
  id: string;
  title: string;
  summary: string;
  strength: "high" | "medium" | "low";
  source: string | null;
  confirmations: number;
  evidence: string[];
  children?: CommercialEvidenceNode[];
};

export type CommercialSignal = {
  label: string;
  weight: "high" | "medium" | "low";
};

export type CommercialOffering = {
  id: string;
  label: string;
  description: string;
  score: number;
  confidence: "high" | "medium" | "low";
  signals: CommercialSignal[];
};

export type CommercialOfferings = {
  software: CommercialOffering[];
  marketing: CommercialOffering[];
  has_data: boolean;
};

export type CommercialOfferType = "software" | "marketing" | "both" | "unknown";

export type CommercialOfferingsSummary = {
  primary_offer_type: CommercialOfferType;
  software_score: number;
  marketing_score: number;
  top_software_offer: string | null;
  top_marketing_offer: string | null;
  top_software_label: string | null;
  top_marketing_label: string | null;
  evidence_count: number;
};

export type LeadDashboard = {
  id: string;
  name: string;
  niche: string | null;
  source: string;
  canonical_source: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  tags: string[];
  state: string;
  prospect_score: number | null;
  contact_tier: string | null;
  primary_offer: string | null;
  pitch_hook: string | null;
  urgency_signal: string | null;
  contacted_by: string | null;
  created_at: string;
  corroborating_sources: { source: string; external_id: string; confidence: number }[];
  top_buyer_type: string | null;
  top_buyer_score: number | null;
  owner_group_id: string | null;
  source_confidence: number | null;
  data_confidence_score: number | null;
  contact_reliability_score: number | null;
  contact_ready: boolean | null;
  sources_count?: number | null;
  // Cluster C — columnas derivadas de lead_dashboard para la grilla social/comercial.
  sources_count_real?: number | null;
  best_contact_email?: string | null;
  sellable?: boolean | null;
  website_kind?: "none" | "social" | "directory" | "real" | null;
  opportunity_no_web?: boolean | null;
  demand_gap_score?: number | null;
  deal_value_tier?: "high" | "medium" | "low" | "unknown" | string | null;
  deal_value_monthly_uyu?: number | null;
  has_social?: boolean | null;
  has_social_candidate?: boolean | null;
  social_platform?: string | null;
  social_instagram_url?: string | null;
  social_followers?: number | null;
  social_audience_tier?: string | null;
  social_status?: string | null;
  commercial_offerings?: CommercialOfferings | null;
  commercial_offers_summary?: CommercialOfferingsSummary | null;
};

export type LeadGeoSelection = {
  parent_location_keys?: string[];
  grid_location_keys?: string[];
};

export type LeadDetail = LeadDashboard & {
  digital_footprint: Record<string, unknown> | null;
  inferred_state: Record<string, unknown> | null;
  score_breakdown: Record<string, unknown> | null;
  lead_company_data: Record<string, unknown> | null;
  canonical_fields: Record<string, unknown> | null;
  field_sources: Record<string, LeadFieldSource> | null;
  commercial_evidence_tree: CommercialEvidenceNode[] | null;
  commercial_offerings: CommercialOfferings | null;
  commercial_offers_summary?: CommercialOfferingsSummary | null;
  notes: string | null;
  business_status: string | null;
};

export async function listLeads(
  token: string,
  params: {
    contact_tier?: string;
    prospect_score_gte?: number;
    niche?: string;
    source?: string;
    primary_offer?: string;
    commercial_offer_type?: CommercialOfferType;
    q?: string;
    sort_by?: "created_at" | "prospect_score" | "marketing_score" | "software_score" | "offer_balance";
    sort_direction?: "asc" | "desc";
    cursor?: string;
    limit?: number;
    parent_location_keys?: string[];
    grid_location_keys?: string[];
  } = {}
) {
  const qp = new URLSearchParams();
  if (params.contact_tier) qp.set("contact_tier", params.contact_tier);
  if (params.prospect_score_gte != null) qp.set("prospect_score_gte", String(params.prospect_score_gte));
  if (params.niche) qp.set("niche", params.niche);
  if (params.source) qp.set("source", params.source);
  if (params.primary_offer) qp.set("primary_offer", params.primary_offer);
  if (params.commercial_offer_type) qp.set("commercial_offer_type", params.commercial_offer_type);
  if (params.q) qp.set("q", params.q);
  if (params.sort_by) qp.set("sort_by", params.sort_by);
  if (params.sort_direction) qp.set("sort_direction", params.sort_direction);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  if (params.parent_location_keys && params.parent_location_keys.length > 0) qp.set("parent_location_keys", params.parent_location_keys.join(","));
  if (params.grid_location_keys && params.grid_location_keys.length > 0) qp.set("grid_location_keys", params.grid_location_keys.join(","));
  return request<PaginatedResponse<LeadDashboard>>(`/api/v1/leads?${qp}`, {}, token);
}

export async function getLead(token: string, id: string) {
  return request<SingleResponse<LeadDetail>>(`/api/v1/leads/${id}`, {}, token);
}

export type OwnerGroupMember = Pick<LeadDashboard, "id" | "name" | "niche" | "contact_tier" | "prospect_score" | "owner_group_id">;

export type LeadFeedbackVerdict = "good" | "bad";

export type LeadFeedbackEntry = {
  id: string;
  lead_id: string;
  field_key: string;
  field_value: unknown;
  verdict: LeadFeedbackVerdict;
  comment: string | null;
  actor_user_id: string;
  actor_role: "admin" | "cm";
  created_at: string;
};

export type LeadFeedbackSummaryEntry = {
  field_key: string;
  total: number;
  good_count: number;
  bad_count: number;
  latest_verdict: LeadFeedbackVerdict;
  latest_comment: string | null;
  latest_at: string | null;
  latest_actor_user_id: string | null;
  latest_actor_role: string | null;
};

export type FeedbackAdjustedConfidence = {
  contact_reliability_score: number | null;
  data_confidence_score: number | null;
  contact_delta: number;
  data_delta: number;
  flagged_fields: string[];
  confirmed_fields: string[];
};

export async function getOwnerGroup(token: string, leadId: string) {
  return request<{ data: OwnerGroupMember[] }>(`/api/v1/leads/${leadId}/owner-group`, {}, token);
}

export async function listLeadFeedback(
  token: string,
  leadId: string,
  params: { field_key?: string; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.field_key) qp.set("field_key", params.field_key);
  if (params.limit) qp.set("limit", String(params.limit));
  const suffix = qp.toString() ? `?${qp}` : "";
  return request<{ data: LeadFeedbackEntry[]; total: number; lead_id: string }>(`/api/v1/leads/${leadId}/feedback${suffix}`, {}, token);
}

export async function getLeadFeedbackSummary(token: string, leadId: string) {
  return request<{ data: LeadFeedbackSummaryEntry[]; lead_id: string }>(`/api/v1/leads/${leadId}/feedback-summary`, {}, token);
}

export async function getLeadFeedbackAdjustedConfidence(token: string, leadId: string) {
  return request<{ data: FeedbackAdjustedConfidence; lead_id: string }>(`/api/v1/leads/${leadId}/feedback-adjusted-confidence`, {}, token);
}

export async function createLeadFeedback(
  token: string,
  leadId: string,
  data: {
    field_key: string;
    field_value?: unknown;
    verdict: LeadFeedbackVerdict;
    comment?: string;
    rejection_reason?: "no_pertenece_al_lead" | "dato_desactualizado" | "fuera_de_servicio" | "otro";
    reassign_to_lead_id?: string;
  }
) {
  return request<{ data: LeadFeedbackEntry; lead_id: string }>(`/api/v1/leads/${leadId}/feedback`, {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export async function updateFavoriteContacts(
  token: string,
  leadId: string,
  favoriteContacts: Array<{ kind: string; value: string }>
) {
  return request<{ data: { lead_id: string; favorite_contacts: unknown[] } }>(
    `/api/v1/leads/${leadId}/favorite-contacts`,
    { method: "PATCH", body: JSON.stringify({ favorite_contacts: favoriteContacts }) },
    token
  );
}

// Búsqueda liviana de leads por nombre para reasignación de contactos.
export async function searchLeadsByName(
  token: string,
  query: string
): Promise<Array<{ id: string; name: string; niche: string | null; city: string | null }>> {
  const res = await listLeads(token, { q: query, limit: 8 });
  return res.data.map((lead) => ({
    id: lead.id,
    name: lead.name,
    niche: (lead as { niche?: string | null }).niche ?? null,
    city: (lead as { location_label?: string | null }).location_label ?? null,
  }));
}

// Outreach — @deprecated: replaced by CRM tracking. Functions kept for FK bridge; do not use in new UI.
export type Campaign = {
  id: string;
  name: string;
  user_id: string;
  segment_filter: Record<string, unknown>;
  status: "active" | "paused" | "closed";
  notes: string | null;
  created_at: string;
  closed_at: string | null;
};

export type CampaignStats = {
  contacted: number;
  responded: number;
  closed_won: number;
  conversion_rate: number;
  avg_score_contacted: number | null;
};

export type OutreachEntry = {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  user_id: string;
  channel: string;
  offer_type: string | null;
  status: string;
  responded: boolean | null;
  outcome: string | null;
  lost_reason: string | null;
  service_sold: string | null;
  price_sold: number | null;
  notes: string | null;
  contacted_at: string;
  responded_at: string | null;
  closed_at: string | null;
  lead_quality_signal: number;
  created_at: string;
};

export async function listOutreach(
  token: string,
  params: { lead_id?: string; campaign_id?: string; status?: string; cursor?: string; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.lead_id) qp.set("lead_id", params.lead_id);
  if (params.campaign_id) qp.set("campaign_id", params.campaign_id);
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<OutreachEntry>>(`/api/v1/outreach?${qp}`, {}, token);
}

export async function listCampaigns(token: string) {
  return request<{ data: Campaign[] }>("/api/v1/campaigns", {}, token);
}

export async function createCampaign(
  token: string,
  data: { name: string; segment_filter?: Record<string, unknown>; notes?: string; status?: "active" | "paused" | "closed" }
) {
  return request<SingleResponse<Campaign>>("/api/v1/campaigns", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export async function getCampaign(token: string, id: string) {
  return request<{ data: Campaign; stats: CampaignStats }>(`/api/v1/campaigns/${id}`, {}, token);
}

export async function patchCampaign(
  token: string,
  id: string,
  data: { name?: string; status?: string; notes?: string | null }
) {
  return request<SingleResponse<Campaign>>(`/api/v1/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }, token);
}

export async function closeCampaign(token: string, id: string): Promise<void> {
  await request<void>(`/api/v1/campaigns/${id}`, { method: "DELETE" }, token);
}

export async function createOutreach(
  token: string,
  data: {
    lead_id: string;
    campaign_id?: string | null;
    channel: string;
    offer_type?: string;
    status?: string;
    notes?: string;
    contacted_at?: string;
  }
) {
  return request<SingleResponse<OutreachEntry>>("/api/v1/outreach", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export async function patchOutreach(
  token: string,
  id: string,
  data: Partial<{
    status: string;
    responded: boolean;
    outcome: string | null;
    lost_reason: string | null;
    service_sold: string;
    price_sold: number;
    notes: string;
    responded_at: string | null;
    closed_at: string | null;
    lead_quality_signal: number;
  }>
) {
  return request<SingleResponse<OutreachEntry>>(`/api/v1/outreach/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }, token);
}

// Discovery
export type DiscoveryJob = {
  id: string;
  batch_id: string | null;
  batch_status?: string | null;
  source: string;
  location: string;
  niche: string | null;
  profile: string | null;
  max_results: number;
  concurrency: number | null;
  cpu_budget: string;
  status: "queued" | "running" | "completed" | "failed" | "paused" | "cancelled";
  triggered_by: string;
  leads_found: number | null;
  leads_new: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  cost_cap_usd?: number | null;
  linked_run_id?: string | null;
  enrich_after_discovery?: boolean;
  enrich_status?: "queued" | "running" | "completed" | "failed" | "skipped";
  linked_enrich_run_id?: string | null;
  enrich_error_message?: string | null;
  source_params?: Record<string, unknown> | null;
  created_at: string;
};

export type PredictiveLocationContext = {
  suggestion_source: "predictive_location";
  location_catalog_entry_id: string;
  opportunity_score_snapshot?: DiscoveryLocationSuggestion;
};

export type DiscoveryJobBatch = {
  id: string;
  location: string;
  location_key: string;
  niche: string | null;
  sources: string[];
  max_results: number;
  cpu_budget: string;
  google_places: {
    profile?: "A" | "B" | "C" | "D";
    concurrency?: number;
    cost_cap_usd: number;
  } | null;
  recommendation_origin: {
    type: "coverage_gap" | "location_density" | "top_niche" | "manual" | "predictive_location";
    key?: string;
  } | null;
  enrich_after_discovery: boolean;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cost_cap_usd: number | null;
  status: "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  jobs?: DiscoveryJob[];
};

export type DiscoveryCoverageGap = {
  key: string;
  location_key: string;
  location_label: string;
  niche: string;
  present_sources: string[];
  missing_sources: string[];
  commercial_density_score: number;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
};

export type DiscoveryLocationDensity = {
  location_key: string;
  location_label: string;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
  commercial_density_score: number;
  gps_points: Array<{ lat: number; lng: number }>;
};

export type DiscoveryMapDensityLocation = {
  location_key: string;
  location_label: string;
  parent_location_key: string;
  parent_location_label: string;
  aggregation_level: "country" | "regional" | "local" | "individual";
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
  avg_marketing_score: number;
  avg_software_score: number;
  intensity_score: number;
  commercial_density_score: number;
  gps_points: Array<{ lat: number; lng: number }>;
  raw_gps_lead_count: number;
  geocoded_lead_count: number;
  grid_center: { lat: number; lng: number };
};

export type DiscoveryLeadDensityGpsSource = "real" | "inferred" | "google";
export type DiscoveryHeatMetric = "mixed" | "marketing" | "software" | "combined";

export type DiscoveryMapViewportBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type DiscoveryLeadDensityFilters = {
  location?: string;
  source?: string[];
  niche?: string;
  prospect_score_gte?: number;
  contact_tier?: string[];
  primary_offer?: string;
  commercial_offer_type?: CommercialOfferType;
  gps_source?: DiscoveryLeadDensityGpsSource[];
  zone_ids?: string[];
  limit?: number;
  heat_metric?: DiscoveryHeatMetric;
  zoom?: number;
  bbox?: DiscoveryMapViewportBounds;
};

export type DiscoveryLeadDensityMeta = {
  raw_gps_leads: number;
  geocoded_address_leads: number;
  unresolved_address_leads: number;
  deferred_geocode_leads: number;
  filtered_leads: number;
  positioned_leads: number;
  grid_cell_size_km: number;
  aggregation_mode: "country" | "regional" | "local" | "individual";
  zoom_bucket: number;
  viewport_lead_count: number;
  cell_size_hint_km: number;
};

export type DiscoveryLocationSuggestion = {
  catalog_entry: DiscoveryPlaceCatalogEntry;
  niche: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  expected_new_leads: number;
  duplicate_risk: number;
  cost_estimate: number | null;
  reasons: string[];
  historical_metrics: {
    jobs_count: number;
    candidates_seen: number;
    new_leads_count: number;
    duplicate_count: number;
    success_rate: number;
    duplicate_rate: number;
    avg_cost_per_new_lead: number | null;
    last_discovery_at: string | null;
    coverage_lead_count: number;
    historical_scope: "direct" | "parent" | "ancestor" | "none";
    inherited_from: string[];
  };
};

export type DiscoveryRecommendationData = {
  coverage_gaps_global: DiscoveryCoverageGap[];
  coverage_gaps_by_location: Array<{
    location_key: string;
    location_label: string;
    commercial_density_score: number;
    gaps: DiscoveryCoverageGap[];
  }>;
  niche_suggestions: Array<{
    key: string;
    niche: string;
    origin: "recent_discovery" | "existing_leads" | "top_by_source";
    source?: string;
    count?: number;
  }>;
  top_niches_by_source: Array<{
    source: string;
    niches: Array<{ niche: string; count: number }>;
  }>;
  google_places_budget: {
    budget_total: number;
    budget_spent: number;
    budget_remaining: number;
    alert_threshold: number;
    over_alert: boolean;
  } | null;
  monthly_cost: number;
  location_density: DiscoveryLocationDensity[];
};

export async function listDiscoveryJobs(
  token: string,
  params: { status?: string; cursor?: string; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<DiscoveryJob>>(`/api/v1/discovery/jobs?${qp}`, {}, token);
}

export async function createDiscoveryJob(
  token: string,
  data: {
    source: string;
    location: string;
    niche?: string;
    profile?: "A" | "B" | "C" | "D";
    max_results?: number;
    concurrency?: number;
    cpu_budget?: string;
    cost_cap_usd?: number;
  }
) {
  return request<SingleResponse<DiscoveryJob>>("/api/v1/discovery/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export type DiscoverySource = "mintur" | "osm" | "yelu" | "pedidosya" | "google_places";

export type BulkJobDefinition = {
  source: DiscoverySource;
  location: string;
  niche: string;
  max_results?: number;
  cost_cap_usd?: number;
  predictive_context?: PredictiveLocationContext;
};

export type BulkJobResult = {
  ids: string[];
  count: number;
  total_estimated_cost_usd: number;
};

export async function bulkCreateDiscoveryJobs(token: string, jobs: BulkJobDefinition[]) {
  return request<{ data: BulkJobResult }>("/api/v1/discovery/jobs/bulk", {
    method: "POST",
    body: JSON.stringify({ jobs }),
  }, token);
}

export async function patchDiscoveryJob(
  token: string,
  id: string,
  action: "pause" | "resume" | "cancel"
) {
  return request<SingleResponse<DiscoveryJob>>(`/api/v1/discovery/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  }, token);
}

export async function listDiscoveryJobBatches(
  token: string,
  params: { status?: string; cursor?: string; limit?: number; include_jobs?: boolean } = {}
) {
  const qp = new URLSearchParams();
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  if (params.include_jobs) qp.set("include_jobs", "true");
  return request<PaginatedResponse<DiscoveryJobBatch>>(`/api/v1/discovery/job-batches?${qp}`, {}, token);
}

export async function createDiscoveryJobBatch(
  token: string,
  data: {
    sources: string[];
    location: string;
    niche?: string;
    max_results?: number;
    cpu_budget?: "conservative" | "balanced" | "aggressive";
    google_places?: { profile?: "A" | "B" | "C" | "D"; concurrency?: number; cost_cap_usd: number };
    recommendation_origin?: { type: "coverage_gap" | "location_density" | "top_niche" | "manual" | "predictive_location"; key?: string };
    enrich_after_discovery?: boolean;
    predictive_context?: PredictiveLocationContext;
  }
) {
  return request<SingleResponse<DiscoveryJobBatch>>("/api/v1/discovery/job-batches", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);
}

export async function patchDiscoveryJobBatch(
  token: string,
  id: string,
  action: "pause" | "resume" | "cancel"
) {
  return request<SingleResponse<DiscoveryJobBatch>>(`/api/v1/discovery/job-batches/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action }),
  }, token);
}

export async function getDiscoveryRecommendations(
  token: string,
  params: { sources?: string[]; location?: string; niche?: string; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.sources && params.sources.length > 0) qp.set("sources", params.sources.join(","));
  if (params.location) qp.set("location", params.location);
  if (params.niche) qp.set("niche", params.niche);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<{ data: DiscoveryRecommendationData }>(`/api/v1/discovery/recommendations?${qp}`, {}, token);
}

export async function getDiscoveryLocationSuggestions(
  token: string,
  params: { departamento?: string; ciudad?: string; barrio?: string; niche?: string; limit?: number; min_score?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.departamento) qp.set("departamento", params.departamento);
  if (params.ciudad) qp.set("ciudad", params.ciudad);
  if (params.barrio) qp.set("barrio", params.barrio);
  if (params.niche) qp.set("niche", params.niche);
  if (params.limit) qp.set("limit", String(params.limit));
  if (params.min_score != null) qp.set("min_score", String(params.min_score));
  return request<{ data: DiscoveryLocationSuggestion[]; total: number }>(`/api/v1/discovery/location-suggestions?${qp}`, {}, token);
}

export function buildDiscoveryGeoFilterQuery(params: DiscoveryLeadDensityFilters = {}): URLSearchParams {
  const qp = new URLSearchParams();
  if (params.location) qp.set("location", params.location);
  if (params.source && params.source.length > 0) qp.set("source", params.source.join(","));
  if (params.niche) qp.set("niche", params.niche);
  if (params.prospect_score_gte != null) qp.set("prospect_score_gte", String(params.prospect_score_gte));
  if (params.contact_tier && params.contact_tier.length > 0) qp.set("contact_tier", params.contact_tier.join(","));
  if (params.primary_offer) qp.set("primary_offer", params.primary_offer);
  if (params.commercial_offer_type) qp.set("commercial_offer_type", params.commercial_offer_type);
  if (params.gps_source && params.gps_source.length > 0) qp.set("gps_source", params.gps_source.join(","));
  if (params.zone_ids && params.zone_ids.length > 0) qp.set("zone_ids", params.zone_ids.join(","));
  if (params.limit) qp.set("limit", String(params.limit));
  if (params.heat_metric) qp.set("heat_metric", params.heat_metric);
  if (params.zoom != null) qp.set("zoom", String(params.zoom));
  if (params.bbox) {
    qp.set("south", String(params.bbox.south));
    qp.set("west", String(params.bbox.west));
    qp.set("north", String(params.bbox.north));
    qp.set("east", String(params.bbox.east));
  }
  return qp;
}

export async function getLeadDensity(
  token: string,
  params: DiscoveryLeadDensityFilters = {}
) {
  const qp = buildDiscoveryGeoFilterQuery(params);
  return request<{ data: { locations: DiscoveryMapDensityLocation[]; exact_points: Array<{ lat: number; lng: number }>; geocoded_points: Array<{ lat: number; lng: number }>; viewport_leads: ZoneLead[]; meta: DiscoveryLeadDensityMeta } }>(`/api/v1/admin/geo/lead-density?${qp}`, {}, token);
}

// Costs
export type BudgetStatus = {
  budget_total: number;
  budget_spent: number;
  budget_remaining: number;
  alert_threshold: number;
  over_alert: boolean;
  request_count: number;
};

export type CostsOverview = {
  month: string;
  totals: {
    llm_usd: number;
    google_places_usd: number;
    infra_usd: number;
    backup_usd: number;
    total_usd: number;
  };
  google_places: BudgetStatus | null;
  llm: {
    total_calls: number;
    total_cost_usd: number;
    by_provider: { provider: string; calls: number; tokens: number; leads_count: number; cost_usd: number }[];
  };
  infra: {
    infra_monthly_cost_usd: number;
    backup_monthly_cost_usd: number;
    total_monthly_cost_usd: number;
  };
  per_lead: {
    hot_leads_count: number;
    total_cost_usd: number;
    cost_per_hot_usd: number | null;
    top_leads: {
      lead_id: string;
      name: string;
      source: string | null;
      llm_cost_usd: number;
      gp_cost_share_usd: number;
      total_cost_usd: number;
    }[];
  };
  per_source: {
    source: string;
    cost_usd: number;
    leads_count: number;
    calls?: number;
    tokens?: number;
  }[];
  ts: string;
};

export type CostsHistory = {
  monthly: {
    month: string;
    google_places_usd: number;
    llm_usd: number;
    infra_usd: number;
    backup_usd: number;
    total_usd: number;
    hot_leads: number;
  }[];
};

export async function getCostsOverview(token: string) {
  return request<{ data: CostsOverview }>("/api/v1/admin/costs/overview", {}, token);
}

export async function getCostsHistory(token: string) {
  return request<{ data: CostsHistory }>("/api/v1/admin/costs/history", {}, token);
}

// Performance
export type PerformanceOverview = {
  days: number;
  runs: {
    total: number;
    successful: number;
    failed: number;
    partial: number;
    aborted: number;
    pending: number;
    running: number;
  };
  duration: {
    avg_min: number;
    total_hours: number;
  };
  per_phase: {
    phase: string;
    avg_min: number;
    pct_of_total: number;
    runs: number;
  }[];
  throughput: {
    enrich_per_hour: number;
    score_per_hour: number;
    discovery_per_min: number;
  };
  success_rate_per_source: {
    source: string;
    success: number;
    total: number;
    errors: number;
    pct: number;
  }[];
  ts: string;
};

export type PerformanceErrorRow = {
  id: string;
  ts: string;
  run_id: string | null;
  phase: string;
  source: string | null;
  lead_id: string | null;
  error_type: string;
  message: string;
  stack: string | null;
  recovered: boolean;
};

export type PerformanceQuality = {
  run_id: string | null;
  window: {
    started_at: string;
    completed_at: string | null;
  } | null;
  coverage: {
    total_leads: number;
    email_quality_pct: number;
    phone_type_pct: number;
    coords_pct: number;
    inferred_state_pct: number;
    contactable_tier_pct: number;
  };
  trend: {
    day: string;
    email_quality_pct: number;
    phone_type_pct: number;
    coords_pct: number;
    inferred_state_pct: number;
    contactable_tier_pct: number;
  }[];
  changes: {
    significant_total: number;
    score_up_15: number;
    score_down_15: number;
    tier_gained: number;
    tier_lost: number;
    new_hot: number;
    by_field: { field: string; count: number }[];
    significant_changes: {
      lead_id: string;
      name: string;
      source: string | null;
      changed_at: string;
      field: string;
      from: unknown;
      to: unknown;
      prospect_score: number | null;
      contact_tier: string | null;
    }[];
  };
  ts: string;
};

export async function getPerformanceOverview(token: string, days = 30) {
  return request<{ data: PerformanceOverview }>(`/api/v1/admin/performance/overview?days=${days}`, {}, token);
}

export async function getPerformanceErrors(
  token: string,
  params: { days?: number; phase?: string; source?: string; error_type?: string; recovered?: boolean; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.days) qp.set("days", String(params.days));
  if (params.phase) qp.set("phase", params.phase);
  if (params.source) qp.set("source", params.source);
  if (params.error_type) qp.set("error_type", params.error_type);
  if (params.recovered !== undefined) qp.set("recovered", String(params.recovered));
  if (params.limit) qp.set("limit", String(params.limit));
  return request<{ data: PerformanceErrorRow[]; total: number }>(`/api/v1/admin/performance/errors?${qp}`, {}, token);
}

export async function getPerformanceQuality(token: string, params: { run_id?: string; days?: number } = {}) {
  const qp = new URLSearchParams();
  if (params.run_id) qp.set("run_id", params.run_id);
  if (params.days) qp.set("days", String(params.days));
  return request<{ data: PerformanceQuality }>(`/api/v1/admin/performance/quality?${qp}`, {}, token);
}

// Stats / Segments
export type StatsOverview = {
  total_leads: number;
  total_outreach: number;
  ts: string;
};

export type StatsOutreachRow = {
  status: string;
};

export type SegmentEntry = { value: string; count: number; avg_score: number | null };
export type SegmentsData = {
  by_niche: SegmentEntry[];
  by_tier: SegmentEntry[];
  by_source: SegmentEntry[];
};

export async function getStatsOverview(token: string) {
  return request<{ data: StatsOverview }>("/api/v1/stats/overview", {}, token);
}

export async function getOutreachStats(token: string) {
  return request<{ data: StatsOutreachRow[] }>("/api/v1/stats/outreach", {}, token);
}

export async function getSegments(token: string) {
  return request<{ data: SegmentsData }>("/api/v1/stats/segments", {}, token);
}

export async function listAuditLog(
  token: string,
  params: {
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  } = {}
) {
  const qp = new URLSearchParams();
  if (params.actor) qp.set("actor", params.actor);
  if (params.action) qp.set("action", params.action);
  if (params.from) qp.set("from", params.from);
  if (params.to) qp.set("to", params.to);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<AuditLogEntry>>(
    `/api/v1/admin/audit-log?${qp}`,
    {},
    token
  );
}

export type OfferPackage = {
  text: string;
  source_llm: string;
  generated_at: string;
  provider?: string;
  model?: string;
};

export type LeadAssistantBrief = {
  summary: string;
  why_it_matters: string;
  next_step: string;
  recommended_channel: string;
  personalized_pitch: string;
  first_message: string;
  likely_objections: string[];
  objection_handling: string[];
  source_llm: string;
  generated_at: string;
  provider?: string;
  model?: string;
};

export function generateOffer(
  token: string,
  params: { lead_id: string; offer_type?: string; channel?: string }
) {
  return request<SingleResponse<OfferPackage>>(
    "/api/v1/outreach/generate-offer",
    { method: "POST", body: JSON.stringify(params) },
    token
  );
}

export function generateLeadBrief(token: string, leadId: string) {
  return request<SingleResponse<LeadAssistantBrief>>(
    "/api/v1/leads/" + leadId + "/assistant-brief",
    { method: "POST" },
    token
  );
}

// CRM Tracking

export type CrmStatus = "pending" | "validation" | "contact" | "observed" | "rejected" | "accepted";

export type LeadTracking = {
  id: string;
  case_code: string;
  title: string;
  lead_id: string;
  lead_name: string | null;
  owner_id: string;
  status: CrmStatus;
  campaign_id: string | null;
  notes: string | null;
  started_at: string;
  updated_at: string;
};

export type LeadTrackingEvent = {
  id: string;
  tracking_id: string;
  event_type: "system_status_change" | "manual_comment";
  from_status: CrmStatus | null;
  to_status: CrmStatus;
  actor_user_id: string;
  actor_role: "admin" | "cm";
  actor_email?: string | null;
  notes: string | null;
  channel: string | null;
  reminder_at: string | null;
  created_at: string;
};

export type LeadTrackingStageDetail = {
  id: string;
  tracking_id: string;
  stage: CrmStatus;
  summary: string | null;
  data: Record<string, unknown>;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type LeadTrackingLeadData = {
  name: string;
  niche: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

export type LeadTrackingDetail = LeadTracking & {
  events: LeadTrackingEvent[];
  lead: LeadTrackingLeadData | null;
  stage_details: LeadTrackingStageDetail[];
};

export function createTracking(
  token: string,
  data: { lead_id: string; title?: string; notes?: string; campaign_id?: string }
) {
  return request<{ data: LeadTracking }>(
    "/api/v1/tracking",
    { method: "POST", body: JSON.stringify(data) },
    token
  );
}

export type TrackingFilters = {
  status?: CrmStatus;
  status_in?: string;
  owner_id?: string;
  lead_id?: string;
  case_code?: string;
  title?: string;
  niche?: string;
  source?: string;
  contact_tier?: string;
  prospect_score_gte?: number;
  created_after?: string;
  q?: string;
  limit?: number;
};

export function listTrackings(token: string, params: TrackingFilters = {}) {
  const qp = new URLSearchParams();
  if (params.status) qp.set("status", params.status);
  if (params.status_in) qp.set("status_in", params.status_in);
  if (params.owner_id) qp.set("owner_id", params.owner_id);
  if (params.lead_id) qp.set("lead_id", params.lead_id);
  if (params.case_code) qp.set("case_code", params.case_code);
  if (params.title) qp.set("title", params.title);
  if (params.niche) qp.set("niche", params.niche);
  if (params.source) qp.set("source", params.source);
  if (params.contact_tier) qp.set("contact_tier", params.contact_tier);
  if (params.prospect_score_gte != null) qp.set("prospect_score_gte", String(params.prospect_score_gte));
  if (params.created_after) qp.set("created_after", params.created_after);
  if (params.q) qp.set("q", params.q);
  if (params.limit) qp.set("limit", String(params.limit));
  const suffix = qp.toString() ? `?${qp}` : "";
  return request<{ data: LeadTracking[]; total: number }>(`/api/v1/tracking${suffix}`, {}, token);
}

export function getTracking(token: string, trackingId: string) {
  return request<{ data: LeadTrackingDetail }>(`/api/v1/tracking/${trackingId}`, {}, token);
}

export function transitionTracking(
  token: string,
  trackingId: string,
  data: { to_status: CrmStatus; notes?: string; channel?: string; reminder_at?: string }
) {
  return request<{ data: LeadTracking }>(
    `/api/v1/tracking/${trackingId}/transition`,
    { method: "POST", body: JSON.stringify(data) },
    token
  );
}

export function addTrackingNote(token: string, trackingId: string, notes: string) {
  return request<{ data: LeadTrackingEvent }>(
    `/api/v1/tracking/${trackingId}/note`,
    { method: "POST", body: JSON.stringify({ notes }) },
    token
  );
}

export function updateTrackingTitle(token: string, trackingId: string, title: string) {
  return request<{ data: LeadTracking }>(
    `/api/v1/tracking/${trackingId}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
    token
  );
}

export function upsertTrackingStageDetails(
  token: string,
  trackingId: string,
  data: { stage?: CrmStatus; summary?: string | null; data?: Record<string, unknown> }
) {
  return request<{ data: LeadTrackingStageDetail }>(
    `/api/v1/tracking/${trackingId}/stage-details`,
    { method: "PUT", body: JSON.stringify(data) },
    token
  );
}

export type DiscoveryPlaceKind =
  | "departamento"
  | "ciudad"
  | "barrio"
  | "zona_turistica"
  | "polo_industrial"
  | "avenida";

export interface DiscoveryPlaceCatalogEntry {
  id: string;
  location_key: string;
  display_name: string;
  parent_location: string | null;
  kind: DiscoveryPlaceKind;
  lat_approx: number | null;
  lng_approx: number | null;
  commercial_score: number | null;
  notes: string | null;
  source: string;
  imported_at: string;
}

export interface DiscoveryGeoZone {
  zone_id: string;
  departamento: string | null;
  ciudad: string | null;
  barrio: string | null;
  label: string;
  kind: DiscoveryPlaceKind;
  lead_count: number;
  last_seen_at: string | null;
}

export interface DiscoveryPlacesImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  row_validation_errors: Array<{ row: number; reason: string }>;
  upsert_errors: Array<{ location_key: string; reason: string }>;
  duplicate_keys: string[];
}

export interface DiscoveryPlacesImportPreview {
  filename: string;
  row_count: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  entries: Array<{
    location_key: string;
    display_name: string;
    parent_location: string | null;
    kind: DiscoveryPlaceKind;
    lat_approx: number | null;
    lng_approx: number | null;
    commercial_score: number | null;
    notes: string | null;
  }>;
  row_validation_errors: Array<{ row: number; reason: string }>;
  duplicate_entries: Array<{ location_key: string; display_name: string }>;
}

export interface DiscoveryPlacesImportHistoryEntry {
  id: string;
  action: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  filename: string | null;
  row_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  invalid_count: number;
  duplicate_count: number;
  upsert: boolean;
}

export async function listDiscoveryPlacesCatalog(
  token: string,
  params: { kind?: DiscoveryPlaceKind; parent_location?: string; q?: string; limit?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.parent_location) qs.set("parent_location", params.parent_location);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: DiscoveryPlaceCatalogEntry[]; total: number }>(
    `/api/v1/admin/discovery/places${suffix}` ,
    {},
    token
  );
}

export async function listDiscoveryPlaceImports(token: string, limit = 20) {
  return request<{ data: DiscoveryPlacesImportHistoryEntry[]; total: number }>(`/api/v1/admin/imports/locations?limit=${limit}`, {}, token);
}

export async function previewDiscoveryPlacesImport(token: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${resolveBaseUrl()}/api/v1/admin/imports/locations/preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error_code?: string }).error_code ?? "unknown_error",
      (body as { error?: string }).error ?? `HTTP ${response.status}`
    );
  }
  return body as { data: DiscoveryPlacesImportPreview };
}

export async function commitDiscoveryPlacesImport(
  token: string,
  payload: { filename: string; upsert: boolean; entries: DiscoveryPlacesImportPreview["entries"] }
) {
  return request<{ data: DiscoveryPlacesImportResult }>(`/api/v1/admin/imports/locations/commit`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function importDiscoveryPlacesXlsx(
  token: string,
  file: File,
  upsert = false
) {
  const formData = new FormData();
  formData.append("file", file);
  const suffix = upsert ? "?upsert=true" : "";
  const response = await fetch(`${resolveBaseUrl()}/api/v1/admin/discovery/places/import${suffix}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error_code?: string }).error_code ?? "unknown_error",
      (body as { error?: string }).error ?? `HTTP ${response.status}`
    );
  }
  return body as { data: DiscoveryPlacesImportResult };
}
export async function listGeoZones(
  token: string,
  params: { kind?: DiscoveryPlaceKind; q?: string; limit?: number } = {}
) {
  const q = new URLSearchParams();
  if (params.kind) q.set("kind", params.kind);
  if (params.q) q.set("q", params.q);
  if (params.limit) q.set("limit", String(params.limit));
  return request<{ data: DiscoveryGeoZone[]; total: number }>(`/api/v1/admin/geo/zones?${q}`, {}, token);
}

// Zone leads — individual map mode
export type ZoneLead = {
  id: string;
  name: string | null;
  niche: string | null;
  contact_tier: string | null;
  prospect_score: number | null;
  address: string | null;
  gps: unknown;
  map_point?: { lat: number; lng: number } | null;
  source: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  rating?: number | null;
  review_count?: number | null;
  primary_offer?: string | null;
  pitch_hook?: string | null;
  contact_ready?: boolean | null;
  tags?: string[] | null;
  commercial_offerings?: CommercialOfferings | null;
};

export async function getZoneLeads(
  token: string,
  params: DiscoveryLeadDensityFilters & { location_key?: string; parent_location_key?: string; grid_location_key?: string; limit?: number }
): Promise<{ data: ZoneLead[]; total: number; has_more: boolean }> {
  const q = buildDiscoveryGeoFilterQuery(params);
  if (params.location_key) q.set("location_key", params.location_key);
  if (params.parent_location_key) q.set("parent_location_key", params.parent_location_key);
  if (params.grid_location_key) q.set("grid_location_key", params.grid_location_key);
  return request<{ data: ZoneLead[]; total: number; has_more: boolean }>(
    `/api/v1/admin/geo/zone-leads?${q}`,
    {},
    token
  );
}

// Niche aliases
export type NicheAliasGroup = {
  id: string;
  canonical: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

export async function listNicheAliasGroups(token: string) {
  return request<{ data: NicheAliasGroup[] }>("/api/v1/admin/niches/groups", {}, token);
}

export async function listDistinctNiches(token: string) {
  return request<{ data: string[]; total: number }>("/api/v1/admin/niches/distinct", {}, token);
}

export async function createNicheAliasGroup(
  token: string,
  canonical: string,
  aliases: string[]
) {
  return request<{ data: NicheAliasGroup }>("/api/v1/admin/niches/groups", {
    method: "POST",
    body: JSON.stringify({ canonical, aliases }),
  }, token);
}

export async function updateNicheAliasGroup(
  token: string,
  id: string,
  canonical: string,
  aliases: string[]
) {
  return request<{ data: NicheAliasGroup }>(`/api/v1/admin/niches/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify({ canonical, aliases }),
  }, token);
}

export async function deleteNicheAliasGroup(token: string, id: string) {
  return request<{ data: { deleted: string } }>(`/api/v1/admin/niches/groups/${id}`, {
    method: "DELETE",
  }, token);
}

// Merge candidates (cola de revisión de uniones cross-source)
export type MergeCandidateLead = {
  id: string;
  name: string;
  source: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  niche: string | null;
  prospect_score: number | null;
};

export type MergeCandidate = {
  id: string;
  match_kind: "phone" | "domain" | "email";
  match_key: string;
  same_city: boolean;
  name_similarity: number;
  reason: string;
  created_at: string;
  primary: MergeCandidateLead;
  secondary: MergeCandidateLead;
};

export async function listMergeCandidates(token: string) {
  return request<{ data: MergeCandidate[]; meta: { total: number } }>(
    "/api/v1/admin/merge-candidates",
    {},
    token
  );
}

export async function approveMergeCandidate(token: string, id: string) {
  return request<{ data: { id: string; status: string; primary_lead_id: string } }>(
    `/api/v1/admin/merge-candidates/${id}/approve`,
    { method: "POST" },
    token
  );
}

export async function rejectMergeCandidate(token: string, id: string) {
  return request<{ data: { id: string; status: string } }>(
    `/api/v1/admin/merge-candidates/${id}/reject`,
    { method: "POST" },
    token
  );
}

// Histórico social (crecimiento, posts/mes, churn) por plataforma
export type SocialHistoryPlatform = {
  followers_growth_30d: { abs: number; pct: number | null } | null;
  posts_per_month: number | null;
  churn_risk: boolean;
  engagement_trend: number | null;
  recency_days: number | null;
  engagement_ratio: number | null;
  series: Array<{ captured_at: string; followers: number | null }>;
  point_count: number;
};

export async function getSocialHistory(token: string, leadId: string) {
  return request<{ data: { lead_id: string; platforms: Record<string, SocialHistoryPlatform> }; meta: { platform_count: number } }>(
    `/api/v1/leads/${leadId}/social-history`,
    {},
    token
  );
}

// Recursos físicos del host (monitoreo)
export type ResourceSnapshot = {
  ram: { used_bytes: number; free_bytes: number; total_bytes: number; pct: number };
  disk: { used_bytes: number; free_bytes: number; total_bytes: number; pct: number } | null;
  cpu: { load_1m: number; cores: number; pct: number };
  processes: Array<{ pid: number; cmd: string; cpu_pct: number; mem_mb: number }>;
  sampled_at: string;
};

export async function getResourceSnapshot(token: string) {
  return request<{ data: ResourceSnapshot }>("/api/v1/admin/monitoring/resources", {}, token);
}
