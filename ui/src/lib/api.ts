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

export async function testWebhook(token: string) {
  return request<SingleResponse<{ status: string; http_status?: number; url: string; error?: string }>>(
    "/api/v1/pipeline/webhook/test",
    { method: "POST" },
    token
  );
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
