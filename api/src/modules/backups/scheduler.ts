import cron from "node-cron";
import {
  buildBackupOverview,
  fetchBackupConfig,
  getDefaultBackupSchedulerSnapshot,
  getNextBackupScheduledFor,
  patchBackupConfig,
  runBackup,
  type BackupSchedulerSnapshot,
} from "./service.js";

const CONFIG_WATCH_INTERVAL_MS = 60_000;

export class BackupScheduler {
  private cronTask: ReturnType<typeof cron.schedule> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private lastConfigUpdatedAt: string | null = null;
  private snapshotState: BackupSchedulerSnapshot = getDefaultBackupSchedulerSnapshot();

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reloadFromConfig();
    await this.touchHeartbeat();

    this.watchTimer = setInterval(() => {
      this.watchConfig().catch((error) => {
        this.setError(error instanceof Error ? error.message : String(error));
      });
    }, CONFIG_WATCH_INTERVAL_MS);
  }

  stop(): void {
    this.cronTask?.stop();
    this.cronTask = null;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.started = false;
    this.snapshotState = {
      ...this.snapshotState,
      started: false,
      cron_active: false,
      status: "stopped",
    };
  }

  getSnapshot(): BackupSchedulerSnapshot {
    return {
      ...this.snapshotState,
      started: this.started,
    };
  }

  async getOverview() {
    return buildBackupOverview(this.getSnapshot());
  }

  private async watchConfig(): Promise<void> {
    const config = await fetchBackupConfig();
    await this.touchHeartbeat();

    if (config.updated_at !== this.lastConfigUpdatedAt) {
      await this.reloadFromConfig(config);
    }
  }

  private async reloadFromConfig(existing?: Awaited<ReturnType<typeof fetchBackupConfig>>): Promise<void> {
    const config = existing ?? await fetchBackupConfig();
    this.lastConfigUpdatedAt = config.updated_at;
    this.snapshotState = {
      ...this.snapshotState,
      started: true,
      last_reload_at: new Date().toISOString(),
      status: config.maintenance_mode ? "maintenance" : config.enabled ? "idle" : "stopped",
      last_error_at: null,
      last_error_message: null,
    };

    this.cronTask?.stop();
    this.cronTask = null;

    if (config.maintenance_mode) {
      this.snapshotState = {
        ...this.snapshotState,
        cron_active: false,
        status: "maintenance",
      };
      return;
    }

    if (!config.enabled) {
      await patchBackupConfig({ scheduled_for: null });
      this.snapshotState = {
        ...this.snapshotState,
        cron_active: false,
        status: "idle",
      };
      return;
    }

    if (!cron.validate(config.cron_expression)) {
      await patchBackupConfig({
        scheduled_for: null,
        last_error_at: new Date().toISOString(),
        last_error_message: "Invalid cron expression",
      });
      this.snapshotState = {
        ...this.snapshotState,
        cron_active: false,
        status: "invalid_cron",
        last_error_at: new Date().toISOString(),
        last_error_message: "Invalid cron expression",
      };
      return;
    }

    await patchBackupConfig({ scheduled_for: getNextBackupScheduledFor(true, config.cron_expression) });

    this.cronTask = cron.schedule(config.cron_expression, async () => {
      this.snapshotState = {
        ...this.snapshotState,
        status: "running",
        last_tick_at: new Date().toISOString(),
      };
      await this.touchHeartbeat();

      try {
        await runBackup("scheduled");
        const refreshed = await fetchBackupConfig();
        if (refreshed.maintenance_mode) {
          this.snapshotState = {
            ...this.snapshotState,
            cron_active: false,
            status: "maintenance",
          };
          return;
        }
        await patchBackupConfig({
          scheduled_for: getNextBackupScheduledFor(true, refreshed.cron_expression),
        });
        this.snapshotState = {
          ...this.snapshotState,
          status: "scheduled",
          last_error_at: null,
          last_error_message: null,
        };
      } catch (error) {
        this.setError(error instanceof Error ? error.message : String(error));
      }
    });

    this.snapshotState = {
      ...this.snapshotState,
      cron_active: true,
      status: "scheduled",
    };
  }

  private async touchHeartbeat(): Promise<void> {
    await patchBackupConfig({ scheduler_heartbeat_at: new Date().toISOString() });
  }

  private setError(message: string): void {
    this.snapshotState = {
      ...this.snapshotState,
      cron_active: Boolean(this.cronTask),
      status: "error",
      last_error_at: new Date().toISOString(),
      last_error_message: message,
    };
  }
}
