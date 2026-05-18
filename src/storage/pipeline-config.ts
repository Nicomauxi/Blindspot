import { getSupabase } from "../shared/supabase.js";

export interface BudgetStatus {
  budget_total: number;
  budget_spent: number;
  budget_remaining: number;
  alert_threshold: number;
  over_alert: boolean;
}

export async function incrementGooglePlacesBudgetSpent(costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const db = getSupabase();
  const { error } = await db.rpc("increment_gp_budget_spent", { amount: costUsd });
  if (error) {
    // Fallback: manual read + update
    const { data } = await db.from("pipeline_config").select("google_places_budget_spent").limit(1).single();
    const current = (data as { google_places_budget_spent: number } | null)?.google_places_budget_spent ?? 0;
    await db.from("pipeline_config").update({ google_places_budget_spent: current + costUsd });
  }
}

export async function getGooglePlacesBudgetStatus(): Promise<BudgetStatus | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("pipeline_config")
    .select("google_places_budget_total, google_places_budget_spent, google_places_alert_threshold")
    .limit(1)
    .single();

  if (error || !data) return null;

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

export async function backfillGooglePlacesBudget(): Promise<{ total_runs: number; total_cost_usd: number }> {
  const db = getSupabase();

  // Sum estimated_cost_usd from all completed runs
  const { data, error } = await db
    .from("runs")
    .select("stats")
    .eq("status", "completed");

  if (error) throw new Error(`backfillGooglePlacesBudget: ${error.message}`);

  let total = 0;
  let count = 0;
  for (const row of data ?? []) {
    const stats = row.stats as Record<string, unknown> | null;
    const cost = typeof stats?.["estimated_cost_usd"] === "number" ? stats["estimated_cost_usd"] : 0;
    total += cost;
    count++;
  }

  await db.from("pipeline_config").update({ google_places_budget_spent: total });
  return { total_runs: count, total_cost_usd: total };
}
