import { getSupabase } from "../shared/supabase.js";

export interface DiscoveryJobRow {
  id: string;
  source: string;
  location: string;
  niche: string | null;
  max_results: number;
  cpu_budget: string;
  status: string;
  triggered_by: string;
  leads_found: number;
  leads_new: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export async function insertDiscoveryJob(opts: {
  source: string;
  location: string;
  niche?: string;
  max_results?: number;
  triggeredBy?: string;
}): Promise<DiscoveryJobRow> {
  const db = getSupabase();
  const { data, error } = await db
    .from("discovery_jobs")
    .insert({
      source: opts.source,
      location: opts.location,
      niche: opts.niche ?? null,
      max_results: opts.max_results ?? 200,
      cpu_budget: "balanced",
      status: "queued",
      triggered_by: opts.triggeredBy ?? "scheduled",
      leads_found: 0,
      leads_new: 0,
    })
    .select()
    .single();

  if (error) throw new Error(`insertDiscoveryJob failed: ${error.message}`);
  return data as DiscoveryJobRow;
}

export async function updateDiscoveryJobStatus(
  id: string,
  status: "running" | "completed" | "failed",
  fields: { leads_found?: number; leads_new?: number; error_message?: string } = {}
): Promise<void> {
  const db = getSupabase();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status };

  if (status === "running") {
    update["started_at"] = now;
  } else {
    update["completed_at"] = now;
    if (fields.leads_found != null) update["leads_found"] = fields.leads_found;
    if (fields.leads_new != null) update["leads_new"] = fields.leads_new;
    if (fields.error_message != null) update["error_message"] = fields.error_message;
  }

  const { error } = await db.from("discovery_jobs").update(update).eq("id", id);
  if (error) throw new Error(`updateDiscoveryJobStatus failed: ${error.message}`);
}
