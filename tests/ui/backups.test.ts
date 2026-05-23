import { describe, expect, it } from "vitest";
import { isAdminRouteAllowed } from "../../ui/src/lib/admin-access";
import { backupPurposeLabel, backupStatusLabel, canDeleteBackup, canRestoreBackup, formatBackupSize } from "../../ui/src/lib/backups";

describe("backups admin UI helpers", () => {
  it("blocks CM on backups route", () => {
    expect(isAdminRouteAllowed("/admin/backups", "cm")).toBe(false);
    expect(isAdminRouteAllowed("/admin/backups/history", "cm")).toBe(false);
    expect(isAdminRouteAllowed("/admin/backups", "admin")).toBe(true);
  });

  it("formats sizes and backup affordances", () => {
    expect(formatBackupSize(512)).toBe("512 B");
    expect(formatBackupSize(2048)).toBe("2.0 KB");
    expect(formatBackupSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(backupStatusLabel("failed")).toBe("Fallido");
    expect(backupPurposeLabel("restore_checkpoint")).toBe("Checkpoint pre-restore");
    expect(canDeleteBackup("completed", null)).toBe(true);
    expect(canDeleteBackup("running", null)).toBe(false);
    expect(canRestoreBackup("completed", null)).toBe(true);
    expect(canRestoreBackup("failed", null)).toBe(false);
  });
});
