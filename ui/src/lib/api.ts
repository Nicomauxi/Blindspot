const BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

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
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
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
  return request<{ token: string }>("/auth/login", {
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
  ts: string;
};

export async function getHealth(token: string) {
  return request<HealthStatus>("/api/v1/health", {}, token);
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
  phases: Record<string, unknown> | null;
  notify_webhook_url: string | null;
  notify_webhook_secret: string | null;
  notify_webhook_events: string[];
  updated_at: string;
};

export async function getPipelineConfig(token: string) {
  return request<SingleResponse<PipelineConfig>>("/api/v1/pipeline/config", {}, token);
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
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  scope: string;
  dry_run: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  phase_results: Record<string, unknown> | null;
  error_message: string | null;
};

export async function triggerPipelineRun(token: string, dryRun = false) {
  return request<{ run_id: string; status: string }>(
    `/api/v1/pipeline/run${dryRun ? "?dry_run=true" : ""}`,
    { method: "POST" },
    token
  );
}

export async function abortPipelineRun(token: string) {
  return request<{ aborted: boolean }>("/api/v1/pipeline/abort", { method: "POST" }, token);
}

export async function listPipelineRuns(token: string, params: { status?: string; cursor?: string; limit?: number } = {}) {
  const qp = new URLSearchParams();
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<PipelineRun>>(`/api/v1/pipeline/runs?${qp}`, {}, token);
}

export async function testWebhook(token: string) {
  return request<SingleResponse<{ status: string; http_status?: number; url: string; error?: string }>>(
    "/api/v1/pipeline/webhook/test",
    { method: "POST" },
    token
  );
}

// Leads
export type LeadDashboard = {
  id: string;
  name: string;
  niche: string | null;
  source: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
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
};

export type LeadDetail = LeadDashboard & {
  digital_footprint: Record<string, unknown> | null;
  inferred_state: Record<string, unknown> | null;
  score_breakdown: Record<string, unknown> | null;
  notes: string | null;
  business_status: string | null;
  source_confidence: number | null;
  data_confidence_score: number | null;
};

export async function listLeads(
  token: string,
  params: {
    contact_tier?: string;
    prospect_score_gte?: number;
    niche?: string;
    source?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  } = {}
) {
  const qp = new URLSearchParams();
  if (params.contact_tier) qp.set("contact_tier", params.contact_tier);
  if (params.prospect_score_gte != null) qp.set("prospect_score_gte", String(params.prospect_score_gte));
  if (params.niche) qp.set("niche", params.niche);
  if (params.source) qp.set("source", params.source);
  if (params.q) qp.set("q", params.q);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<LeadDashboard>>(`/api/v1/leads?${qp}`, {}, token);
}

export async function getLead(token: string, id: string) {
  return request<SingleResponse<LeadDetail>>(`/api/v1/leads/${id}`, {}, token);
}

// Outreach
export type OutreachEntry = {
  id: string;
  lead_id: string;
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
  params: { lead_id?: string; status?: string; cursor?: string; limit?: number } = {}
) {
  const qp = new URLSearchParams();
  if (params.lead_id) qp.set("lead_id", params.lead_id);
  if (params.status) qp.set("status", params.status);
  if (params.cursor) qp.set("cursor", params.cursor);
  if (params.limit) qp.set("limit", String(params.limit));
  return request<PaginatedResponse<OutreachEntry>>(`/api/v1/outreach?${qp}`, {}, token);
}

export async function createOutreach(
  token: string,
  data: {
    lead_id: string;
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
  source: string;
  location: string;
  niche: string | null;
  profile: string | null;
  max_results: number;
  cpu_budget: string;
  status: "queued" | "running" | "completed" | "failed" | "paused" | "cancelled";
  triggered_by: string;
  leads_found: number | null;
  leads_new: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
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
  data: { source: string; location: string; niche?: string; max_results?: number; cpu_budget?: string }
) {
  return request<SingleResponse<DiscoveryJob>>("/api/v1/discovery/jobs", {
    method: "POST",
    body: JSON.stringify(data),
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
export type SegmentEntry = { value: string; count: number; avg_score: number | null };
export type SegmentsData = {
  by_niche: SegmentEntry[];
  by_tier: SegmentEntry[];
  by_source: SegmentEntry[];
};

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
