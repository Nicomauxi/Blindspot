// N27 — Los reminders del CRM eran write-only: la UI prometía un recordatorio que
// nadie consumía. Este job (corre en el scheduler) genera system_alerts dirigidas al
// owner del caso cuando un reminder_at vence en un tracking activo.
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { createAlert } from "../../storage/alerts.js";

const ACTIVE_TRACKING_STATUSES = ["pending", "validation", "contact", "observed"] as const;
// Reminders vencidos hace más de esto se ignoran (evita spamear histórico al activar el job).
const REMINDER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// La dedup de createAlert es por ventana: una semana cubre el lookback completo.
const DEDUP_WINDOW_MINUTES = 7 * 24 * 60;

interface DueReminderRow {
  id: string;
  tracking_id: string;
  reminder_at: string;
  notes: string | null;
  lead_tracking: {
    owner_id: string;
    status: string;
    title: string | null;
    case_code: string | null;
    lead_id: string;
  } | null;
}

export async function processDueCrmReminders(now: Date = new Date()): Promise<number> {
  const db = getSupabase();
  const lookbackIso = new Date(now.getTime() - REMINDER_LOOKBACK_MS).toISOString();

  const { data, error } = await db
    .from("lead_tracking_events")
    .select("id, tracking_id, reminder_at, notes, lead_tracking!inner(owner_id, status, title, case_code, lead_id)")
    .not("reminder_at", "is", null)
    .lte("reminder_at", now.toISOString())
    .gte("reminder_at", lookbackIso)
    .in("lead_tracking.status", [...ACTIVE_TRACKING_STATUSES])
    .limit(200);

  if (error) {
    getLogger().error({ err: error.message }, "crm reminder poll failed");
    return 0;
  }

  let created = 0;
  for (const row of (data ?? []) as unknown as DueReminderRow[]) {
    const tracking = row.lead_tracking;
    if (!tracking) continue;
    const caseLabel = tracking.case_code ?? row.tracking_id;
    const alert = await createAlert({
      kind: "crm_reminder_due",
      severity: "info",
      title: `Recordatorio CRM: ${tracking.title ?? caseLabel}`,
      description: `El caso ${caseLabel} tiene un recordatorio vencido (${row.reminder_at}).${row.notes ? ` Nota: ${row.notes.slice(0, 200)}` : ""}`,
      payload: { tracking_id: row.tracking_id, event_id: row.id, lead_id: tracking.lead_id, reminder_at: row.reminder_at },
      target_user_id: tracking.owner_id,
      // Una alerta por evento de reminder — no re-spamea en cada poll.
      dedup_key: `crm_reminder_due:${row.id}`,
      dedup_window_minutes: DEDUP_WINDOW_MINUTES,
    }).catch((err) => {
      getLogger().warn({ err: String(err), eventId: row.id }, "crm reminder alert failed");
      return null;
    });
    if (alert) created += 1;
  }

  if (created > 0) {
    getLogger().info({ created }, "CRM reminder alerts created");
  }
  return created;
}
