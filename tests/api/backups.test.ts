import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

type BackupRunState = {
  id: string;
  trigger: "manual" | "scheduled";
  purpose: "standard" | "restore_checkpoint";
  status: "running" | "completed" | "failed";
  path: string | null;
  filename: string | null;
  created_at: string;
  completed_at: string | null;
  size_bytes: number | null;
  error_message: string | null;
  cleanup_deleted_count: number;
  cleanup_error_message: string | null;
  deleted_at: string | null;
};

type BackupRestoreState = {
  id: string;
  backup_run_id: string | null;
  checkpoint_backup_run_id: string | null;
  status: "running" | "completed" | "failed";
  backup_path: string | null;
  backup_filename: string | null;
  checkpoint_path: string | null;
  checkpoint_filename: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  triggered_by_user_id: string | null;
  maintenance_started_at: string | null;
  maintenance_finished_at: string | null;
};

const state: {
  user: Row;
  pipelineConfig: Row;
  backupConfig: Row;
  backupRuns: BackupRunState[];
  backupRestores: BackupRestoreState[];
  deletedPaths: string[];
  files: string[];
  fileSizes: Record<string, number>;
} = {
  user: {
    id: "admin-id",
    email: "admin@test.local",
    role: "admin",
    active: true,
    lead_filter: null,
  },
  pipelineConfig: {
    id: "singleton",
    enabled: false,
    cron_expression: "0 2 * * 0",
    scheduled_for: null,
    last_completed_at: null,
    notify_webhook_url: null,
    notify_webhook_events: [],
  },
  backupConfig: {
    id: "singleton",
    updated_at: "2026-05-22T10:00:00Z",
    enabled: false,
    cron_expression: "0 3 * * *",
    scheduled_for: null,
    directory: "/safe/backups",
    max_backups: 2,
    last_started_at: null,
    last_completed_at: null,
    last_successful_at: null,
    last_error_at: null,
    last_error_message: null,
    scheduler_heartbeat_at: "2026-05-22T10:00:00Z",
    maintenance_mode: false,
    maintenance_started_at: null,
    restore_started_at: null,
    restore_completed_at: null,
    restore_error_at: null,
    restore_error_message: null,
  },
  backupRuns: [],
  backupRestores: [],
  deletedPaths: [],
  files: [],
  fileSizes: {},
};

const { execFileMock, statMock, accessMock, unlinkMock, readdirMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
  accessMock: vi.fn(),
  unlinkMock: vi.fn(),
  readdirMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  stat: statMock,
  access: accessMock,
  unlink: unlinkMock,
  readdir: readdirMock,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function listBackupRuns() {
  return state.backupRuns
    .filter((row) => row.deleted_at == null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.user, error: null }),
            }),
          }),
        };
      }

      if (table === "lead_dashboard") {
        return {
          select: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        };
      }

      if (table === "pipeline_config") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: clone(state.pipelineConfig), error: null }),
            }),
          }),
        };
      }

      if (table === "pipeline_runs") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            in: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "discovery_jobs") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            in: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }

      if (table === "backup_config") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: clone(state.backupConfig), error: null }),
            }),
          }),
          update: (payload: Row) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  state.backupConfig = { ...state.backupConfig, ...payload };
                  return { data: clone(state.backupConfig), error: null };
                },
              }),
            }),
          }),
        };
      }

      if (table === "backup_runs") {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({ data: clone(listBackupRuns()), error: null }),
              }),
            }),
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => ({
                data: clone(state.backupRuns.find((row) => row.id === value) ?? null),
                error: null,
              }),
            }),
          }),
          insert: (payload: Row) => ({
            select: () => ({
              single: async () => {
                const row: BackupRunState = {
                  id: (payload.id as string | undefined) ?? `backup-${state.backupRuns.length + 1}`,
                  trigger: payload.trigger as BackupRunState["trigger"],
                  purpose: (payload.purpose as BackupRunState["purpose"] | undefined) ?? "standard",
                  status: payload.status as BackupRunState["status"],
                  path: (payload.path as string | null | undefined) ?? null,
                  filename: (payload.filename as string | null | undefined) ?? null,
                  created_at: (payload.created_at as string | undefined) ?? nowIso(),
                  completed_at: (payload.completed_at as string | null | undefined) ?? null,
                  size_bytes: (payload.size_bytes as number | null | undefined) ?? null,
                  error_message: (payload.error_message as string | null | undefined) ?? null,
                  cleanup_deleted_count: (payload.cleanup_deleted_count as number | undefined) ?? 0,
                  cleanup_error_message: (payload.cleanup_error_message as string | null | undefined) ?? null,
                  deleted_at: (payload.deleted_at as string | null | undefined) ?? null,
                };
                state.backupRuns.unshift(row);
                return { data: clone(row), error: null };
              },
            }),
          }),
          update: (payload: Row) => ({
            eq: (_column: string, value: string) => ({
              select: () => ({
                single: async () => {
                  const idx = state.backupRuns.findIndex((row) => row.id === value);
                  if (idx === -1) return { data: null, error: { message: "not found" } };
                  state.backupRuns[idx] = { ...state.backupRuns[idx], ...payload } as BackupRunState;
                  return { data: clone(state.backupRuns[idx]), error: null };
                },
              }),
            }),
          }),
        };
      }

      if (table === "backup_restores") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: clone(state.backupRestores.slice().reverse()), error: null }),
            }),
          }),
          insert: (payload: Row) => ({
            select: () => ({
              single: async () => {
                const row: BackupRestoreState = {
                  id: (payload.id as string | undefined) ?? `restore-${state.backupRestores.length + 1}`,
                  backup_run_id: (payload.backup_run_id as string | null | undefined) ?? null,
                  checkpoint_backup_run_id: (payload.checkpoint_backup_run_id as string | null | undefined) ?? null,
                  status: payload.status as BackupRestoreState["status"],
                  backup_path: (payload.backup_path as string | null | undefined) ?? null,
                  backup_filename: (payload.backup_filename as string | null | undefined) ?? null,
                  checkpoint_path: (payload.checkpoint_path as string | null | undefined) ?? null,
                  checkpoint_filename: (payload.checkpoint_filename as string | null | undefined) ?? null,
                  started_at: (payload.started_at as string | undefined) ?? nowIso(),
                  completed_at: (payload.completed_at as string | null | undefined) ?? null,
                  error_message: (payload.error_message as string | null | undefined) ?? null,
                  triggered_by_user_id: (payload.triggered_by_user_id as string | null | undefined) ?? null,
                  maintenance_started_at: (payload.maintenance_started_at as string | null | undefined) ?? null,
                  maintenance_finished_at: (payload.maintenance_finished_at as string | null | undefined) ?? null,
                };
                state.backupRestores.unshift(row);
                return { data: clone(row), error: null };
              },
            }),
          }),
        };
      }

      if (table === "audit_log") {
        return {
          insert: async () => ({ error: null }),
        };
      }

      return {};
    },
  }),
}));

async function createApp() {
  const { buildServer } = await import("../../api/src/server.js");
  return buildServer();
}

describe("admin backups", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    state.user = {
      id: "admin-id",
      email: "admin@test.local",
      role: "admin",
      active: true,
      lead_filter: null,
    };
    state.pipelineConfig = {
      id: "singleton",
      enabled: false,
      cron_expression: "0 2 * * 0",
      scheduled_for: null,
      last_completed_at: null,
      notify_webhook_url: null,
      notify_webhook_events: [],
    };
    state.backupConfig = {
      id: "singleton",
      updated_at: nowIso(),
      enabled: false,
      cron_expression: "0 3 * * *",
      scheduled_for: null,
      directory: "/safe/backups",
      max_backups: 2,
      last_started_at: null,
      last_completed_at: null,
      last_successful_at: null,
      last_error_at: null,
      last_error_message: null,
      scheduler_heartbeat_at: nowIso(),
      maintenance_mode: false,
      maintenance_started_at: null,
      restore_started_at: null,
      restore_completed_at: null,
      restore_error_at: null,
      restore_error_message: null,
    };
    state.backupRuns = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        trigger: "manual",
        purpose: "standard",
        status: "completed",
        path: "/safe/backups/blindspot_20260520_010000.sql.gz",
        filename: "blindspot_20260520_010000.sql.gz",
        created_at: "2026-05-20T01:00:00Z",
        completed_at: "2026-05-20T01:01:00Z",
        size_bytes: 20480,
        error_message: null,
        cleanup_deleted_count: 0,
        cleanup_error_message: null,
        deleted_at: null,
      },
    ];
    state.backupRestores = [];
    state.deletedPaths = [];
    state.files = ["blindspot_20260520_010000.sql.gz"];
    state.fileSizes = {
      "/safe/backups": 0,
      "/safe/backups/blindspot_20260520_010000.sql.gz": 20480,
      "/safe/backups/blindspot_manual_new.sql.gz": 40960,
      "/safe/backups/blindspot_restore-checkpoint_20260522_120000.sql.gz": 45000,
    };

    execFileMock.mockReset();
    statMock.mockReset();
    accessMock.mockReset();
    unlinkMock.mockReset();
    readdirMock.mockReset();

    statMock.mockImplementation(async (target: string) => ({
      isDirectory: () => target === "/safe/backups",
      size: state.fileSizes[target] ?? 20480,
      mtime: new Date("2026-05-22T12:00:00Z"),
    }));
    accessMock.mockResolvedValue(undefined);
    unlinkMock.mockImplementation(async (target: string) => {
      state.deletedPaths.push(target);
    });
    readdirMock.mockResolvedValue(state.files);
    execFileMock.mockImplementation((_cmd: string, args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      const script = String(args[0] ?? "");
      if (script.endsWith("backup.sh")) {
        callback(null, "Backup OK: /safe/backups/blindspot_manual_new.sql.gz (40960 bytes)", "");
        return;
      }
      if (script.endsWith("restore.sh")) {
        callback(null, "Restore OK: /safe/backups/blindspot_20260520_010000.sql.gz", "");
        return;
      }
      callback(new Error("unexpected script"), "", "unexpected");
    });
  });

  it("runs manual backup, persists metadata and applies retention", async () => {
    const app = await createApp();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/backups/run",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({
      trigger: "manual",
      purpose: "standard",
      status: "completed",
      filename: "blindspot_manual_new.sql.gz",
    });
    await app.close();
  });

  it("restores a backup with checkpoint and maintenance metadata", async () => {
    const app = await createApp();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/backups/11111111-1111-4111-8111-111111111111/restore",
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation: "RESTORE" },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({
      status: "completed",
      backup_run_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(state.backupConfig).toMatchObject({ maintenance_mode: false });
    expect(state.backupRuns.some((row) => row.purpose === "restore_checkpoint")).toBe(true);
    expect(state.backupRestores).toHaveLength(1);
    expect(state.backupRestores[0]).toMatchObject({ status: "completed", triggered_by_user_id: "admin-id" });
    await app.close();
  });

  it("rejects invalid cron expressions", async () => {
    const app = await createApp();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/backups/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { cron_expression: "bad cron" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error_code: "invalid_cron_expression" });
    await app.close();
  });

  it("rejects missing or non-writable directories", async () => {
    const app = await createApp();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    statMock.mockRejectedValueOnce(new Error("missing"));
    const missingRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/backups/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { directory: "/missing/backups" },
    });
    expect(missingRes.statusCode).toBe(400);
    expect(missingRes.json()).toMatchObject({ error_code: "backup_directory_missing" });

    statMock.mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date("2026-05-22T12:00:00Z") });
    accessMock.mockRejectedValueOnce(new Error("denied"));
    const deniedRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/backups/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { directory: "/locked/backups" },
    });
    expect(deniedRes.statusCode).toBe(400);
    expect(deniedRes.json()).toMatchObject({ error_code: "backup_directory_not_writable" });

    await app.close();
  });

  it("persists backup config and exposes restore state in health/system", async () => {
    const app = await createApp();
    const token = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/backups/config",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true, cron_expression: "0 4 * * *", max_backups: 5 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(state.backupConfig).toMatchObject({ enabled: true, cron_expression: "0 4 * * *", max_backups: 5 });

    const restoreRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/backups/11111111-1111-4111-8111-111111111111/restore",
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation: "RESTORE" },
    });
    expect(restoreRes.statusCode).toBe(202);

    const healthRes = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().backups).toMatchObject({ max_backups: 5 });
    expect(healthRes.json().backups.last_restore.status).toBe("completed");

    const systemRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/system/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(systemRes.statusCode).toBe(200);
    expect(systemRes.json().data.backups?.config).toMatchObject({ max_backups: 5, cron_expression: "0 4 * * *" });
    expect(systemRes.json().data.backups?.restore?.last_restore?.status).toBe("completed");

    await app.close();
  });

  it("blocks CM and allows safe delete", async () => {
    const app = await createApp();
    const adminToken = app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });
    state.user = { ...state.user, role: "cm" };
    const cmToken = app.jwt.sign({ user_id: "admin-id", email: "cm@test.local" });

    const forbiddenRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/backups",
      headers: { authorization: `Bearer ${cmToken}` },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    state.user = { ...state.user, role: "admin" };
    const deleteResOk = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/backups/11111111-1111-4111-8111-111111111111",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteResOk.statusCode).toBe(200);
    expect(state.deletedPaths).toContain("/safe/backups/blindspot_20260520_010000.sql.gz");
    await app.close();
  });
});
