export function formatBackupSize(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function backupStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completado";
    case "running":
      return "Ejecutando";
    case "failed":
      return "Fallido";
    default:
      return status;
  }
}

export function canDeleteBackup(status: string, deletedAt: string | null | undefined): boolean {
  return status !== "running" && !deletedAt;
}

export function canRestoreBackup(status: string, deletedAt: string | null | undefined): boolean {
  return status === "completed" && !deletedAt;
}

export function backupPurposeLabel(purpose: string): string {
  return purpose === "restore_checkpoint" ? "Checkpoint pre-restore" : "Backup";
}
