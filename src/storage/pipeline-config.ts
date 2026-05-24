import { getSupabase } from "../shared/supabase.js";

export interface BudgetStatus {
  budget_total: number;
  budget_spent: number;
  budget_remaining: number;
  alert_threshold: number;
  over_alert: boolean;
}

export interface BudgetIncrementResult {
  budget_spent: number;
  budget_total: number;
  over_budget: boolean;
}

export async function incrementGooglePlacesBudgetSpent(costUsd: number): Promise<BudgetIncrementResult | null> {
  if (costUsd <= 0) return null;
  const db = getSupabase();
  const { data, error } = await db.rpc("increment_gp_budget_spent", { amount: costUsd });
  if (error) throw new Error(`incrementGooglePlacesBudgetSpent: ${error.message}`);
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { google_places_budget_spent: number; google_places_budget_total: number; over_budget: boolean };
  return {
    budget_spent: row.google_places_budget_spent,
    budget_total: row.google_places_budget_total,
    over_budget: row.over_budget,
  };
}

export async function getGooglePlacesBudgetStatus(): Promise<BudgetStatus | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("pipeline_config")
    .select("google_places_budget_total, google_places_budget_spent, google_places_alert_threshold")
    .limit(1)
    .single();

  if (error) {
    throw new Error(`getGooglePlacesBudgetStatus failed: ${error.message}`);
  }
  if (!data) return null;

  const row = data as {
    google_places_budget_total: number;
    google_places_budget_spent: number;
    google_places_alert_threshold: number;
  };

  const budget_remaining = row.google_places_budget_total - row.google_places_budget_spent;
  return {
    budget_total: row.google_places_budget_total,
    budget_spent: row.google_places_budget_spent,
    budget_remaining,
    alert_threshold: row.google_places_alert_threshold,
    over_alert: budget_remaining < row.google_places_alert_threshold,
  };
}

function startOfCurrentMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * Recalcula google_places_budget_spent sumando estimated_cost_usd de todos los runs
 * completados del mes en curso que tengan ese campo en sus stats.
 *
 * Cuándo correr: tras aplicar la migración del RPC increment_gp_budget_spent por
 * primera vez, o tras detectar que budget_spent quedó en 0 con runs completados.
 */
export async function backfillGooglePlacesBudget(): Promise<{ total_runs: number; total_cost_usd: number }> {
  const db = getSupabase();
  const pageSize = 1000;
  const monthStart = startOfCurrentMonth();

  let total = 0;
  let count = 0;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from("runs")
      .select("stats")
      .eq("status", "completed")
      .gte("finished_at", monthStart)
      .range(from, to);

    if (error) throw new Error(`backfillGooglePlacesBudget: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      const stats = row.stats as Record<string, unknown> | null;
      const cost = typeof stats?.["estimated_cost_usd"] === "number" ? stats["estimated_cost_usd"] : 0;
      total += cost;
      if (cost > 0) count++;
    }

    if (batch.length < pageSize) break;
  }

  const { error: updateError } = await db
    .from("pipeline_config")
    .update({ google_places_budget_spent: total })
    .eq("id", "singleton");
  if (updateError) {
    throw new Error(`backfillGooglePlacesBudget update failed: ${updateError.message}`);
  }

  return { total_runs: count, total_cost_usd: total };
}
