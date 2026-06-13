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

export interface BudgetReservation {
  reserved: number;
  budget_spent: number;
  budget_total: number;
}

/**
 * FD-03: reserva atómica de presupuesto GP ANTES de gastar. Devuelve cuánto se pudo reservar
 * (min(requested, remaining)); dos llamadas concurrentes se serializan en DB (FOR UPDATE) y
 * la suma de reservas nunca excede el remaining → no hay sobre-gasto en USD.
 */
export async function reserveGooglePlacesBudget(requestedUsd: number): Promise<BudgetReservation> {
  if (!(requestedUsd > 0)) return { reserved: 0, budget_spent: 0, budget_total: 0 };
  const db = getSupabase();
  const { data, error } = await db.rpc("reserve_gp_budget", { requested: requestedUsd });
  if (error) throw new Error(`reserveGooglePlacesBudget: ${error.message}`);
  if (!data || !Array.isArray(data) || data.length === 0) return { reserved: 0, budget_spent: 0, budget_total: 0 };
  const row = data[0] as { reserved: number; google_places_budget_spent: number; google_places_budget_total: number };
  return { reserved: Number(row.reserved), budget_spent: Number(row.google_places_budget_spent), budget_total: Number(row.google_places_budget_total) };
}

/**
 * FD-03: reconcilia el gasto real contra lo reservado. delta = gasto_real − reservado
 * (negativo = refund de lo no usado). Reemplaza al increment post-gasto en el flujo con reserva.
 */
export async function adjustGooglePlacesBudgetSpent(deltaUsd: number): Promise<BudgetIncrementResult | null> {
  if (deltaUsd === 0) return null;
  const db = getSupabase();
  const { data, error } = await db.rpc("adjust_gp_budget_spent", { delta: deltaUsd });
  if (error) throw new Error(`adjustGooglePlacesBudgetSpent: ${error.message}`);
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { google_places_budget_spent: number; google_places_budget_total: number; over_budget: boolean };
  return { budget_spent: Number(row.google_places_budget_spent), budget_total: Number(row.google_places_budget_total), over_budget: row.over_budget };
}

export async function getGooglePlacesBudgetStatus(): Promise<BudgetStatus | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("pipeline_config")
    .select("google_places_budget_total, google_places_budget_spent, google_places_alert_threshold, google_places_budget_month")
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
    google_places_budget_month?: string | null;
  };

  // N4.4: el spent es MENSUAL — si la fila quedó de un mes anterior, el gasto efectivo
  // de este mes es 0 (el RPC de increment resetea al primer gasto del mes nuevo).
  const currentMonth = new Date().toISOString().slice(0, 7);
  const effectiveSpent = row.google_places_budget_month === currentMonth ? row.google_places_budget_spent : 0;
  const budget_remaining = row.google_places_budget_total - effectiveSpent;
  return {
    budget_total: row.google_places_budget_total,
    budget_spent: effectiveSpent,
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
