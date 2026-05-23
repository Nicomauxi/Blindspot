import { BackupScheduler } from "./scheduler.js";

let scheduler: BackupScheduler | null = null;

export function getBackupScheduler(): BackupScheduler {
  if (!scheduler) scheduler = new BackupScheduler();
  return scheduler;
}
