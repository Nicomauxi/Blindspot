import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";

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
  enrich_after_discovery?: boolean;
  enrich_status?: string;
  linked_enrich_run_id?: string | null;
  enrich_error_message?: string | null;
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

export type DiscoveryJobEnrichStatus = "queued" | "running" | "completed" | "failed" | "skipped";

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

const BATCH_REFRESH_ROW_LIMIT = 1000;

async function refreshDiscoveryBatchStatus(batchId: string): Promise<void> {
  const db = getSupabase();
  const { data, error } = await db
    .from("discovery_jobs")
    .select("status, started_at, completed_at, estimated_cost_usd, actual_cost_usd")
    .eq("batch_id", batchId)
    .limit(BATCH_REFRESH_ROW_LIMIT);

  if (error) throw new Error(`refreshDiscoveryBatchStatus failed: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length >= BATCH_REFRESH_ROW_LIMIT) {
    // Safeguard against unbounded SELECT: if we ever hit the limit the batch
    // aggregate is computed over a truncated set. Pagination is the proper
    // fix — for now we surface the condition.
    getLogger().warn(
      { batchId, limit: BATCH_REFRESH_ROW_LIMIT },
      "refreshDiscoveryBatchStatus hit row limit — aggregate may be incomplete; consider paginating"
    );
  }
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
  enrich_after_discovery?: boolean;
  enrich_status?: DiscoveryJobEnrichStatus;
  /**
   * Skip the batch aggregate refresh after inserting. Use when inserting many
   * jobs into the same batch in a loop — call refreshDiscoveryBatchStatus once
   * at the end instead of paying for N round-trips.
   */
  skipBatchRefresh?: boolean;
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
      enrich_after_discovery: opts.enrich_after_discovery ?? false,
      enrich_status: opts.enrich_status ?? (opts.enrich_after_discovery ? "queued" : "skipped"),
    })
    .select()
    .single();

  if (error) throw new Error(`insertDiscoveryJob failed: ${error.message}`);

  const row = data as DiscoveryJobRow;
  if (row.batch_id && !opts.skipBatchRefresh) {
    await refreshDiscoveryBatchStatus(row.batch_id);
  }
  return row;
}

export interface BulkJobDefinition {
  source: string;
  location: string;
  niche: string;
  max_results?: number;
  cost_cap_usd?: number | null;
  estimated_cost_usd?: number | null;
  source_params?: Record<string, unknown> | null;
}

export async function bulkInsertDiscoveryJobs(
  jobs: BulkJobDefinition[],
  triggeredBy = "admin_bulk"
): Promise<DiscoveryJobRow[]> {
  if (jobs.length === 0) return [];
  const db = getSupabase();
  const rows = jobs.map((j) => ({
    source: j.source,
    location: j.location,
    niche: j.niche,
    max_results: j.max_results ?? 200,
    cpu_budget: "balanced",
    status: "queued",
    triggered_by: triggeredBy,
    leads_found: 0,
    leads_new: 0,
    batch_id: null,
    cost_cap_usd: j.cost_cap_usd ?? null,
    estimated_cost_usd: j.estimated_cost_usd ?? null,
    source_params: j.source_params ?? null,
    enrich_after_discovery: false,
    enrich_status: "skipped",
  }));
  const { data, error } = await db
    .from("discovery_jobs")
    .insert(rows)
    .select();
  if (error) throw new Error(`bulkInsertDiscoveryJobs failed: ${error.message}`);
  return (data ?? []) as DiscoveryJobRow[];
}

// N40: claim atómico queued→running. El path viejo (update incondicional) permitía
// que el timer del scheduler y la fase discovery del run ejecuten el MISMO job.
export async function claimDiscoveryJob(id: string): Promise<boolean> {
  const db = getSupabase();
  const { data, error } = await db
    .from("discovery_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), completed_at: null })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (error) throw new Error(`claimDiscoveryJob failed: ${error.message}`);
  return (data ?? []).length > 0;
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

export async function updateDiscoveryJobEnrichmentStatus(
  id: string,
  status: DiscoveryJobEnrichStatus,
  fields: {
    linked_enrich_run_id?: string | null;
    enrich_error_message?: string | null;
  } = {}
): Promise<void> {
  const db = getSupabase();
  const update: Record<string, unknown> = {
    enrich_status: status,
    enrich_error_message: fields.enrich_error_message ?? null,
  };

  if (fields.linked_enrich_run_id !== undefined) {
    update["linked_enrich_run_id"] = fields.linked_enrich_run_id;
  }

  const { error } = await db.from("discovery_jobs").update(update).eq("id", id);
  if (error) throw new Error(`updateDiscoveryJobEnrichmentStatus failed: ${error.message}`);
}
