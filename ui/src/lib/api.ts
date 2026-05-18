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
