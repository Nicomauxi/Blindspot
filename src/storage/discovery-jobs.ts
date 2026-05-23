import { getSupabase } from "../shared/supabase.js";

export interface DiscoveryJobRow {
  id: string;
  batch_id: string | null;
  source: string;
  location: string;
  niche: string | null;
  profile?: string | null;
  concurrency?: number | null;
  max_results: number;
  cpu_budget: string;
  status: string;
  triggered_by: string;
  leads_found: number;
  leads_new: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  cost_cap_usd?: number | null;
  linked_run_id?: string | null;
  source_params?: Record<string, unknown> | null;
  created_at: string;
}

type DiscoveryJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function aggregateBatchStatus(statuses: DiscoveryJobStatus[]): string {
  if (statuses.length === 0) return "queued";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.every((status) => status === "queued" || status === "paused")) return "queued";
  if (statuses.some((status) => status === "failed" || status === "cancelled")) return "partial";
  if (statuses.some((status) => status === "completed")) return "partial";
  return "queued";
}

async function refreshDiscoveryBatchStatus(batchId: string): Promise<void> {
  const db = getSupabase();
  const { data, error } = await db
    .from("discovery_jobs")
    .select("status, started_at, completed_at, estimated_cost_usd, actual_cost_usd")
    .eq("batch_id", batchId);

  if (error) throw new Error(`refreshDiscoveryBatchStatus failed: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const statuses = rows
    .map((row) => row["status"])
    .filter((value): value is DiscoveryJobStatus => typeof value === "string");

  const startedAtValues = rows
    .map((row) => row["started_at"])
    .filter((value): value is string => typeof value === "string")
    .sort();
  const completedAtValues = rows
    .map((row) => row["completed_at"])
    .filter((value): value is string => typeof value === "string")
    .sort();

  const estimatedCostUsd = rows.reduce((sum, row) => sum + asNumber(row["estimated_cost_usd"]), 0);
  const actualCostUsd = rows.reduce((sum, row) => sum + asNumber(row["actual_cost_usd"]), 0);
  const nextStatus = aggregateBatchStatus(statuses);
  const isTerminal = statuses.length > 0 && statuses.every((status) => ["completed", "failed", "cancelled"].includes(status));

  const { error: updateError } = await db
    .from("discovery_job_batches")
    .update({
      status: nextStatus,
      started_at: startedAtValues[0] ?? null,
      completed_at: isTerminal ? completedAtValues[completedAtValues.length - 1] ?? new Date().toISOString() : null,
      estimated_cost_usd: estimatedCostUsd,
      actual_cost_usd: actualCostUsd,
    })
    .eq("id", batchId);

  if (updateError) throw new Error(`refreshDiscoveryBatchStatus batch update failed: ${updateError.message}`);
}

export async function insertDiscoveryJob(opts: {
  source: string;
  location: string;
  niche?: string;
  max_results?: number;
  triggeredBy?: string;
  batch_id?: string | null;
  profile?: string | null;
  concurrency?: number | null;
  cpu_budget?: string;
  estimated_cost_usd?: number | null;
  cost_cap_usd?: number | null;
  source_params?: Record<string, unknown> | null;
}): Promise<DiscoveryJobRow> {
  const db = getSupabase();
  const { data, error } = await db
    .from("discovery_jobs")
    .insert({
      source: opts.source,
      location: opts.location,
      niche: opts.niche ?? null,
      profile: opts.profile ?? null,
      concurrency: opts.concurrency ?? null,
      max_results: opts.max_results ?? 200,
      cpu_budget: opts.cpu_budget ?? "balanced",
      status: "queued",
      triggered_by: opts.triggeredBy ?? "scheduled",
      leads_found: 0,
      leads_new: 0,
      batch_id: opts.batch_id ?? null,
      estimated_cost_usd: opts.estimated_cost_usd ?? null,
      cost_cap_usd: opts.cost_cap_usd ?? null,
      source_params: opts.source_params ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`insertDiscoveryJob failed: ${error.message}`);

  const row = data as DiscoveryJobRow;
  if (row.batch_id) {
    await refreshDiscoveryBatchStatus(row.batch_id);
  }
  return row;
}

export async function updateDiscoveryJobStatus(
  id: string,
  status: DiscoveryJobStatus,
  fields: {
    leads_found?: number;
    leads_new?: number;
    error_message?: string;
    actual_cost_usd?: number;
    estimated_cost_usd?: number;
    linked_run_id?: string;
  } = {}
): Promise<void> {
  const db = getSupabase();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status };

  if (status === "running") {
    update["started_at"] = now;
    update["completed_at"] = null;
  }

  if (["completed", "failed", "cancelled"].includes(status)) {
    update["completed_at"] = now;
  }

  if (fields.leads_found != null) update["leads_found"] = fields.leads_found;
  if (fields.leads_new != null) update["leads_new"] = fields.leads_new;
  if (fields.error_message != null) update["error_message"] = fields.error_message;
  if (fields.actual_cost_usd != null) update["actual_cost_usd"] = fields.actual_cost_usd;
  if (fields.estimated_cost_usd != null) update["estimated_cost_usd"] = fields.estimated_cost_usd;
  if (fields.linked_run_id != null) update["linked_run_id"] = fields.linked_run_id;

  const { data, error } = await db
    .from("discovery_jobs")
    .update(update)
    .eq("id", id)
    .select("batch_id")
    .single();

  if (error) throw new Error(`updateDiscoveryJobStatus failed: ${error.message}`);

  const batchId = (data as { batch_id?: string | null } | null)?.batch_id ?? null;
  if (batchId) {
    await refreshDiscoveryBatchStatus(batchId);
  }
}
