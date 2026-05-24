import { getSupabase } from "../shared/supabase.js";

export type AlertSeverity = "info" | "warn" | "critical";
export type AlertStatus = "pending" | "read" | "archived";

export interface SystemAlert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  payload: Record<string, unknown> | null;
  target_user_id: string | null;
  status: AlertStatus;
  created_at: string;
  read_at: string | null;
  read_by: string | null;
  dedup_key: string | null;
}

export interface CreateAlertInput {
  kind: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  payload?: Record<string, unknown>;
  target_user_id?: string | null;
  dedup_key?: string;
  dedup_window_minutes?: number;
}

export async function createAlert(input: CreateAlertInput): Promise<SystemAlert | null> {
  const db = getSupabase();

  if (input.dedup_key) {
    const windowMs = (input.dedup_window_minutes ?? 60) * 60 * 1000;
    const since = new Date(Date.now() - windowMs).toISOString();
    const { data: existing } = await db
      .from("system_alerts")
      .select("id")
      .eq("dedup_key", input.dedup_key)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (existing) return null;
  }

  const { data, error } = await db
    .from("system_alerts")
    .insert({
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      description: input.description,
      payload: input.payload ?? null,
      target_user_id: input.target_user_id ?? null,
      dedup_key: input.dedup_key ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createAlert failed: ${error.message}`);
  return data as SystemAlert;
}

export async function listAlerts(
  userId: string,
  params: { status?: AlertStatus; limit?: number; offset?: number } = {}
): Promise<SystemAlert[]> {
  const db = getSupabase();
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const archiveCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const broadcastQ = db
    .from("system_alerts")
    .select("*")
    .is("target_user_id", null)
    .neq("status", "archived")
    .gte("created_at", archiveCutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  const targetedQ = db
    .from("system_alerts")
    .select("*")
    .eq("target_user_id", userId)
    .neq("status", "archived")
    .gte("created_at", archiveCutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.status) {
    broadcastQ.eq("status", params.status);
    targetedQ.eq("status", params.status);
  }

  const [broadcastRes, targetedRes] = await Promise.all([broadcastQ, targetedQ]);

  if (broadcastRes.error) throw new Error(`listAlerts broadcast failed: ${broadcastRes.error.message}`);
  if (targetedRes.error) throw new Error(`listAlerts targeted failed: ${targetedRes.error.message}`);

  const combined = [
    ...(broadcastRes.data ?? []) as SystemAlert[],
    ...(targetedRes.data ?? []) as SystemAlert[],
  ];

  combined.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return combined.slice(offset, offset + limit);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = getSupabase();
  const archiveCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [broadcastRes, targetedRes] = await Promise.all([
    db.from("system_alerts").select("id", { count: "exact", head: true })
      .is("target_user_id", null)
      .eq("status", "pending")
      .gte("created_at", archiveCutoff),
    db.from("system_alerts").select("id", { count: "exact", head: true })
      .eq("target_user_id", userId)
      .eq("status", "pending")
      .gte("created_at", archiveCutoff),
  ]);

  return (broadcastRes.count ?? 0) + (targetedRes.count ?? 0);
}

export async function markAlertRead(alertId: string, userId: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from("system_alerts")
    .update({ status: "read", read_at: new Date().toISOString(), read_by: userId })
    .eq("id", alertId)
    .eq("status", "pending");
  if (error) throw new Error(`markAlertRead failed: ${error.message}`);
}

export async function archiveAlert(alertId: string, _userId: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from("system_alerts")
    .update({ status: "archived" })
    .eq("id", alertId)
    .neq("status", "archived");
  if (error) throw new Error(`archiveAlert failed: ${error.message}`);
}
