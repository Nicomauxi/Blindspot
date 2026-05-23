import type { FastifyInstance } from "fastify";
import { getDb } from "../db/client.js";
import { buildBackupOverview, getDefaultBackupSchedulerSnapshot } from "../modules/backups/service.js";
import { getBackupScheduler } from "../modules/backups/runtime.js";

async function safeBackupOverview() {
  try {
    return await buildBackupOverview(getBackupScheduler().getSnapshot());
  } catch {
    try {
      return await buildBackupOverview(getDefaultBackupSchedulerSnapshot());
    } catch {
      return null;
    }
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const db = getDb();

    const { error: dbError } = await db
      .from("pipeline_config")
      .select("id")
      .eq("id", "singleton")
      .single();

    const dbOk = !dbError;

    const { error: leadDashboardSchemaError } = await db
      .from("lead_dashboard")
      .select("canonical_source, phone, whatsapp, website, tags, state, owner_group_id, digital_footprint, score_breakdown")
      .limit(1);

    const leadDashboardSchemaCurrent = !leadDashboardSchemaError;

    const { data: lastRun } = await db
      .from("pipeline_runs")
      .select("id, status, completed_at, dashboard_stale")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: config } = await db
      .from("pipeline_config")
      .select("enabled, cron_expression, scheduled_for, last_completed_at")
      .eq("id", "singleton")
      .single();

    const cronMissed =
      config?.enabled &&
      config.scheduled_for &&
      new Date(config.scheduled_for).getTime() < Date.now() - 15 * 60 * 1000 &&
      (!config.last_completed_at || new Date(config.last_completed_at) < new Date(config.scheduled_for));

    const backupOverview = await safeBackupOverview();
    const backupCritical = backupOverview?.alerts.some((alert) =>
      ["backup_recent_failure", "backup_scheduler_stale", "backup_directory_invalid", "backup_restore_in_progress", "backup_restore_failed"].includes(alert)
    ) ?? false;

    const healthy = dbOk && leadDashboardSchemaCurrent && !backupCritical;

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      db: dbOk ? "connected" : "error",
      last_run: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            completed_at: lastRun.completed_at,
            dashboard_stale: lastRun.dashboard_stale,
          }
        : null,
      cron: {
        enabled: config?.enabled ?? false,
        scheduled_for: config?.scheduled_for ?? null,
        last_completed_at: config?.last_completed_at ?? null,
        missed: cronMissed ?? false,
      },
      backups: backupOverview
        ? {
            last_backup: backupOverview.summary.last_backup,
            next_backup_at: backupOverview.summary.next_backup_at,
            scheduler: backupOverview.scheduler,
            directory: backupOverview.config.effective_directory,
            directory_valid: backupOverview.config.directory_valid,
            count: backupOverview.summary.backup_count,
            max_backups: backupOverview.summary.max_backups,
            retention: backupOverview.summary.retention,
            manual_backup_count: backupOverview.summary.manual_backup_count,
            scheduled_backup_count: backupOverview.summary.scheduled_backup_count,
            restore_checkpoint_count: backupOverview.summary.restore_checkpoint_count,
            alerts: backupOverview.alerts,
            maintenance_mode: backupOverview.config.maintenance_mode,
            last_restore: backupOverview.summary.last_restore,
            restore: backupOverview.restore,
          }
        : null,
      invariants: {
        scoring_v1_columns_present: true,
        lead_dashboard_schema_current: leadDashboardSchemaCurrent,
      },
      ts: new Date().toISOString(),
    });
  });
}
