import { access, readdir, stat, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, parse, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CronExpressionParser } from "cron-parser";
import { getDb } from "../../db/client.js";

const BACKUP_SCRIPT_PATH = fileURLToPath(new URL("../../../../scripts/backup.sh", import.meta.url));
const RESTORE_SCRIPT_PATH = fileURLToPath(new URL("../../../../scripts/restore.sh", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DEFAULT_CRON = "0 3 * * *";
const DEFAULT_MAX_BACKUPS = 7;
const MAX_BACKUPS_LIMIT = 365;
const RETENTION_SCAN_LIMIT = MAX_BACKUPS_LIMIT * 2 + 50;
const BACKUP_SCHEDULER_STALE_MS = 5 * 60 * 1000;
const BACKUP_SYNC_LIMIT = 500;
const TIMESTAMP_PATTERN = /(\d{8}_\d{6})\.sql\.gz$/;

const BACKUP_TIMEOUT_MS  = 20 * 60 * 1000; // 20 min — generous for large DBs
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

function runScript(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = BACKUP_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("bash", [scriptPath], { env, timeout: timeoutMs, killSignal: "SIGTERM" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

let activeBackupExecution: Promise<BackupRunRow> | null = null;
let activeRestoreExecution: Promise<BackupRestoreRow> | null = null;
let activeRestoreState: RestoreRuntimeState | null = null;

export type BackupTrigger = "manual" | "scheduled";
export type BackupPurpose = "standard" | "restore_checkpoint";
export type BackupStatus = "running" | "completed" | "failed";
export type BackupSchedulerStatus = "stopped" | "idle" | "scheduled" | "invalid_cron" | "running" | "error" | "maintenance";
export type BackupRestoreStatus = "running" | "completed" | "failed";

export type BackupConfigRow = {
  id: "singleton";
  updated_at: string;
  enabled: boolean;
  cron_expression: string;
  scheduled_for: string | null;
  directory: string | null;
  max_backups: number;
  max_manual_backups: number;
  max_scheduled_backups: number;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_successful_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  scheduler_heartbeat_at: string | null;
  maintenance_mode: boolean;
  maintenance_started_at: string | null;
  restore_started_at: string | null;
  restore_completed_at: string | null;
  restore_error_at: string | null;
  restore_error_message: string | null;
};

export type BackupRunRow = {
  id: string;
  trigger: BackupTrigger;
  purpose: BackupPurpose;
  status: BackupStatus;
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

export type BackupRestoreRow = {
  id: string;
  backup_run_id: string | null;
  checkpoint_backup_run_id: string | null;
  status: BackupRestoreStatus;
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

export type BackupSchedulerSnapshot = {
  started: boolean;
  cron_active: boolean;
  status: BackupSchedulerStatus;
  last_reload_at: string | null;
  last_tick_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
};

export type BackupOverview = {
  config: BackupConfigRow & {
    effective_directory: string;
    directory_valid: boolean;
    directory_error: string | null;
  };
  scheduler: BackupSchedulerSnapshot;
  summary: {
    last_backup: BackupRunRow | null;
    next_backup_at: string | null;
    backup_count: number;
    max_backups: number;
    manual_backup_count: number;
    scheduled_backup_count: number;
    restore_checkpoint_count: number;
    retention: {
      manual: { count: number; max: number };
      scheduled: { count: number; max: number };
    };
    database_size_bytes: number | null;
    stored_backup_size_bytes: number;
    stored_backup_size_by_trigger: {
      manual: number;
      scheduled: number;
    };
    last_restore: BackupRestoreRow | null;
  };
  restore: {
    active: RestoreRuntimeState | null;
    last_restore: BackupRestoreRow | null;
  };
  alerts: string[];
  recent: BackupRunRow[];
};

type RestoreRuntimeState = {
  status: BackupRestoreStatus;
  backup_run_id: string;
  backup_filename: string | null;
  checkpoint_backup_run_id: string | null;
  checkpoint_filename: string | null;
  started_at: string;
  maintenance_started_at: string;
  completed_at: string | null;
  error_message: string | null;
  triggered_by_user_id: string | null;
};

type UpdateBackupConfigInput = Partial<{
  enabled: boolean;
  cron_expression: string;
  directory: string | null;
  max_backups: number;
  max_manual_backups: number;
  max_scheduled_backups: number;
  scheduled_for: string | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_successful_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  scheduler_heartbeat_at: string | null;
  maintenance_mode: boolean;
  maintenance_started_at: string | null;
  restore_started_at: string | null;
  restore_completed_at: string | null;
  restore_error_at: string | null;
  restore_error_message: string | null;
}>;

type DirectoryValidation = {
  ok: boolean;
  errorCode: BackupOperationError["errorCode"] | null;
  message: string | null;
  resolvedPath: string;
};

type RetentionSummary = {
  manual: { count: number; max: number };
  scheduled: { count: number; max: number };
};

type BackupRunInsert = {
  id?: string;
  trigger: BackupTrigger;
  purpose?: BackupPurpose;
  status: BackupStatus;
  path?: string | null;
  filename?: string | null;
  created_at?: string;
  completed_at?: string | null;
  size_bytes?: number | null;
  error_message?: string | null;
  cleanup_deleted_count?: number;
  cleanup_error_message?: string | null;
  deleted_at?: string | null;
};

function asBackupConfigRow(value: unknown): BackupConfigRow {
  const row = value as Record<string, unknown>;
  const legacyMax = Number(row.max_backups ?? DEFAULT_MAX_BACKUPS);
  const maxManual = Number(row.max_manual_backups ?? legacyMax);
  const maxScheduled = Number(row.max_scheduled_backups ?? legacyMax);
  return {
    ...(row as BackupConfigRow),
    max_backups: legacyMax,
    max_manual_backups: Number.isFinite(maxManual) ? maxManual : DEFAULT_MAX_BACKUPS,
    max_scheduled_backups: Number.isFinite(maxScheduled) ? maxScheduled : DEFAULT_MAX_BACKUPS,
  };
}

function asBackupRunRow(value: unknown): BackupRunRow {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    trigger: row.trigger as BackupTrigger,
    purpose: (row.purpose as BackupPurpose | undefined) ?? "standard",
    status: row.status as BackupStatus,
    path: (row.path as string | null | undefined) ?? null,
    filename: (row.filename as string | null | undefined) ?? null,
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string | null | undefined) ?? null,
    size_bytes: (row.size_bytes as number | null | undefined) ?? null,
    error_message: (row.error_message as string | null | undefined) ?? null,
    cleanup_deleted_count: Number(row.cleanup_deleted_count ?? 0),
    cleanup_error_message: (row.cleanup_error_message as string | null | undefined) ?? null,
    deleted_at: (row.deleted_at as string | null | undefined) ?? null,
  };
}

function asBackupRestoreRow(value: unknown): BackupRestoreRow {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    backup_run_id: (row.backup_run_id as string | null | undefined) ?? null,
    checkpoint_backup_run_id: (row.checkpoint_backup_run_id as string | null | undefined) ?? null,
    status: row.status as BackupRestoreStatus,
    backup_path: (row.backup_path as string | null | undefined) ?? null,
    backup_filename: (row.backup_filename as string | null | undefined) ?? null,
    checkpoint_path: (row.checkpoint_path as string | null | undefined) ?? null,
    checkpoint_filename: (row.checkpoint_filename as string | null | undefined) ?? null,
    started_at: String(row.started_at),
    completed_at: (row.completed_at as string | null | undefined) ?? null,
    error_message: (row.error_message as string | null | undefined) ?? null,
    triggered_by_user_id: (row.triggered_by_user_id as string | null | undefined) ?? null,
    maintenance_started_at: (row.maintenance_started_at as string | null | undefined) ?? null,
    maintenance_finished_at: (row.maintenance_finished_at as string | null | undefined) ?? null,
  };
}

export class BackupOperationError extends Error {
  constructor(
    public readonly errorCode:
      | "backup_already_running"
      | "backup_config_missing"
      | "invalid_cron_expression"
      | "backup_directory_missing"
      | "backup_directory_not_absolute"
      | "backup_directory_not_writable"
      | "backup_directory_unsafe"
      | "backup_failed"
      | "cleanup_failed"
      | "backup_not_found"
      | "backup_delete_forbidden"
      | "backup_delete_failed"
      | "restore_already_running"
      | "restore_not_found"
      | "restore_file_missing"
      | "restore_checkpoint_failed"
      | "restore_failed"
      | "restore_validation_failed"
      | "restore_pipeline_busy",
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "BackupOperationError";
  }
}

export function getDefaultBackupDirectory(): string {
  return process.env["BLINDSPOT_BACKUP_DIR"] ?? resolve(homedir(), "blindspot-backups");
}

export function getEffectiveBackupDirectory(config: Pick<BackupConfigRow, "directory">): string {
  const raw = config.directory?.trim();
  return raw && raw.length > 0 ? raw : getDefaultBackupDirectory();
}

export function parseCronExpression(expression: string): Date {
  try {
    const interval = CronExpressionParser.parse(expression);
    return interval.next().toDate();
  } catch {
    throw new BackupOperationError("invalid_cron_expression", "Invalid cron expression", 400);
  }
}

export async function validateBackupDirectory(directory: string): Promise<DirectoryValidation> {
  const resolvedPath = resolve(directory);
  if (!isAbsolute(directory)) {
    return {
      ok: false,
      errorCode: "backup_directory_not_absolute",
      message: "Backup directory must be absolute",
      resolvedPath,
    };
  }

  if (resolvedPath === parse(resolvedPath).root) {
    return {
      ok: false,
      errorCode: "backup_directory_unsafe",
      message: "Backup directory cannot be filesystem root",
      resolvedPath,
    };
  }

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        errorCode: "backup_directory_missing",
        message: "Backup directory does not exist",
        resolvedPath,
      };
    }
  } catch {
    return {
      ok: false,
      errorCode: "backup_directory_missing",
      message: "Backup directory does not exist",
      resolvedPath,
    };
  }

  try {
    await access(resolvedPath, fsConstants.W_OK);
  } catch {
    return {
      ok: false,
      errorCode: "backup_directory_not_writable",
      message: "Backup directory is not writable",
      resolvedPath,
    };
  }

  return { ok: true, errorCode: null, message: null, resolvedPath };
}

function parseBackupScriptOutput(stdout: string): { path: string; sizeBytes: number } {
  const match = stdout.match(/Backup OK:\s(.+)\s\((\d+) bytes\)/);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new BackupOperationError("backup_failed", "Backup completed without parseable output", 500);
  }

  return {
    path: match[1].trim(),
    sizeBytes: Number(match[2]),
  };
}

function parseRestoreScriptOutput(stdout: string): { path: string } {
  const match = stdout.match(/Restore OK:\s(.+)/);
  if (!match || match[1] === undefined) {
    throw new BackupOperationError("restore_failed", "Restore completed without parseable output", 500);
  }

  return { path: match[1].trim() };
}

function pathBelongsToDirectory(filePath: string, directory: string): boolean {
  const rel = relative(resolve(directory), resolve(filePath));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`) && !rel.startsWith("/"));
}

function inferTriggerFromFilename(filename: string): BackupTrigger {
  return filename.includes("_scheduled_") ? "scheduled" : "manual";
}

function inferPurposeFromFilename(filename: string): BackupPurpose {
  return filename.includes("restore-checkpoint") ? "restore_checkpoint" : "standard";
}

function inferTimestampFromFilename(filename: string, statsMtimeIso: string): string {
  const match = filename.match(TIMESTAMP_PATTERN);
  if (!match || match[1] === undefined) return statsMtimeIso;
  const value = match[1];
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  return Number.isNaN(new Date(normalized).getTime()) ? statsMtimeIso : normalized;
}

function getRetentionSummary(config: Pick<BackupConfigRow, "max_backups" | "max_manual_backups" | "max_scheduled_backups">): RetentionSummary {
  const fallback = Number.isFinite(config.max_backups) ? config.max_backups : DEFAULT_MAX_BACKUPS;
  const manual = Number.isFinite(config.max_manual_backups) ? config.max_manual_backups : fallback;
  const scheduled = Number.isFinite(config.max_scheduled_backups) ? config.max_scheduled_backups : fallback;
  return {
    manual: { count: 0, max: Math.min(Math.max(manual, 1), MAX_BACKUPS_LIMIT) },
    scheduled: { count: 0, max: Math.min(Math.max(scheduled, 1), MAX_BACKUPS_LIMIT) },
  };
}

async function fetchDatabaseSizeBytes(): Promise<number | null> {
  const db = getDb();
  const { data, error } = await db.rpc("get_database_size_bytes");
  if (error) return null;
  if (typeof data === "number") return Number.isFinite(data) ? data : null;
  if (typeof data === "string") {
    const parsed = Number(data);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function fetchBackupConfig(): Promise<BackupConfigRow> {
  const db = getDb();
  const { data, error } = await db
    .from("backup_config")
    .select("*")
    .eq("id", "singleton")
    .single();

  if (error || !data) {
    throw new BackupOperationError("backup_config_missing", "Backup config not found", 500);
  }

  return asBackupConfigRow(data);
}

export async function patchBackupConfig(update: UpdateBackupConfigInput): Promise<BackupConfigRow> {
  const db = getDb();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) payload[key] = value;
  }

  const explicitLegacyMax = payload.max_backups;
  const nextManual = Number(payload.max_manual_backups ?? payload.max_backups);
  const nextScheduled = Number(payload.max_scheduled_backups ?? payload.max_backups);
  if (Number.isFinite(nextManual) || Number.isFinite(nextScheduled) || explicitLegacyMax !== undefined) {
    const current = await fetchBackupConfig();
    const manual = Number.isFinite(nextManual) ? nextManual : current.max_manual_backups;
    const scheduled = Number.isFinite(nextScheduled) ? nextScheduled : current.max_scheduled_backups;
    payload.max_manual_backups = manual;
    payload.max_scheduled_backups = scheduled;
    payload.max_backups = explicitLegacyMax !== undefined ? Number(explicitLegacyMax) : Math.max(manual, scheduled);
  }

  const { data, error } = await db
    .from("backup_config")
    .update(payload)
    .eq("id", "singleton")
    .select("*")
    .single();

  if (error || !data) {
    throw new BackupOperationError("backup_config_missing", "Unable to update backup config", 500);
  }

  return asBackupConfigRow(data);
}

async function fetchBackupRunById(id: string): Promise<BackupRunRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("backup_runs")
    .select("id, trigger, purpose, status, path, filename, created_at, completed_at, size_bytes, error_message, cleanup_deleted_count, cleanup_error_message, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return asBackupRunRow(data);
}

async function listBackupRestores(limit = 20): Promise<BackupRestoreRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("backup_restores")
    .select("id, backup_run_id, checkpoint_backup_run_id, status, backup_path, backup_filename, checkpoint_path, checkpoint_filename, started_at, completed_at, error_message, triggered_by_user_id, maintenance_started_at, maintenance_finished_at")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(asBackupRestoreRow);
}

async function insertBackupRun(payload: BackupRunInsert): Promise<BackupRunRow> {
  const db = getDb();
  const insertPayload: Record<string, unknown> = {
    trigger: payload.trigger,
    purpose: payload.purpose ?? "standard",
    status: payload.status,
    path: payload.path ?? null,
    filename: payload.filename ?? null,
    created_at: payload.created_at,
    completed_at: payload.completed_at ?? null,
    size_bytes: payload.size_bytes ?? null,
    error_message: payload.error_message ?? null,
    cleanup_deleted_count: payload.cleanup_deleted_count ?? 0,
    cleanup_error_message: payload.cleanup_error_message ?? null,
    deleted_at: payload.deleted_at ?? null,
  };
  if (payload.id) insertPayload.id = payload.id;

  const { data, error } = await db
    .from("backup_runs")
    .insert(insertPayload)
    .select("id, trigger, purpose, status, path, filename, created_at, completed_at, size_bytes, error_message, cleanup_deleted_count, cleanup_error_message, deleted_at")
    .single();

  if (error || !data) {
    throw new BackupOperationError("backup_failed", "Unable to create backup run", 500);
  }

  return asBackupRunRow(data);
}

async function updateBackupRun(id: string, update: Record<string, unknown>): Promise<BackupRunRow> {
  const db = getDb();
  const { data, error } = await db
    .from("backup_runs")
    .update(update)
    .eq("id", id)
    .select("id, trigger, purpose, status, path, filename, created_at, completed_at, size_bytes, error_message, cleanup_deleted_count, cleanup_error_message, deleted_at")
    .single();

  if (error || !data) {
    throw new BackupOperationError("backup_failed", "Unable to update backup run", 500);
  }

  return asBackupRunRow(data);
}

async function ensureBackupRunPersisted(snapshot: BackupRunRow): Promise<BackupRunRow> {
  const existing = await fetchBackupRunById(snapshot.id);
  if (existing) {
    return updateBackupRun(snapshot.id, {
      trigger: snapshot.trigger,
      purpose: snapshot.purpose,
      status: snapshot.status,
      path: snapshot.path,
      filename: snapshot.filename,
      created_at: snapshot.created_at,
      completed_at: snapshot.completed_at,
      size_bytes: snapshot.size_bytes,
      error_message: snapshot.error_message,
      cleanup_deleted_count: snapshot.cleanup_deleted_count,
      cleanup_error_message: snapshot.cleanup_error_message,
      deleted_at: snapshot.deleted_at,
    });
  }

  return insertBackupRun({
    id: snapshot.id,
    trigger: snapshot.trigger,
    purpose: snapshot.purpose,
    status: snapshot.status,
    path: snapshot.path,
    filename: snapshot.filename,
    created_at: snapshot.created_at,
    completed_at: snapshot.completed_at,
    size_bytes: snapshot.size_bytes,
    error_message: snapshot.error_message,
    cleanup_deleted_count: snapshot.cleanup_deleted_count,
    cleanup_error_message: snapshot.cleanup_error_message,
    deleted_at: snapshot.deleted_at,
  });
}

async function insertBackupRestore(payload: Omit<BackupRestoreRow, "id"> & { id?: string }): Promise<BackupRestoreRow> {
  const db = getDb();
  const { data, error } = await db
    .from("backup_restores")
    .insert(payload)
    .select("id, backup_run_id, checkpoint_backup_run_id, status, backup_path, backup_filename, checkpoint_path, checkpoint_filename, started_at, completed_at, error_message, triggered_by_user_id, maintenance_started_at, maintenance_finished_at")
    .single();

  if (error || !data) {
    throw new BackupOperationError("restore_failed", "Unable to write restore metadata", 500);
  }

  return asBackupRestoreRow(data);
}

async function ensureNoPipelineActivity(): Promise<void> {
  const db = getDb();
  const [{ data: pipelineRun }, { data: discoveryJob }] = await Promise.all([
    db.from("pipeline_runs").select("id").in("status", ["pending", "running"]).limit(1).maybeSingle(),
    db.from("discovery_jobs").select("id").in("status", ["queued", "running"]).limit(1).maybeSingle(),
  ]);

  if (pipelineRun || discoveryJob) {
    throw new BackupOperationError("restore_pipeline_busy", "Pipeline or discovery work is still active", 409);
  }
}

async function markBackupFailure(runId: string, message: string): Promise<BackupRunRow> {
  const now = new Date().toISOString();
  await patchBackupConfig({
    last_completed_at: now,
    last_error_at: now,
    last_error_message: message,
  });
  return updateBackupRun(runId, {
    status: "failed",
    completed_at: now,
    error_message: message,
  });
}

async function applyRetention(config: BackupConfigRow): Promise<{ deletedCount: number; errorMessage: string | null }> {
  const recent = await listBackupRuns(RETENTION_SCAN_LIMIT, false);
  const completed = recent.filter((row) => row.status === "completed" && row.path);
  const retention = getRetentionSummary(config);
  const manualCompleted = completed.filter((row) => row.trigger === "manual");
  const scheduledCompleted = completed.filter((row) => row.trigger === "scheduled");
  const toDelete = [
    ...manualCompleted.slice(retention.manual.max),
    ...scheduledCompleted.slice(retention.scheduled.max),
  ];
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  let deletedCount = 0;
  const errors: string[] = [];

  for (const row of toDelete) {
    const targetPath = row.path;
    if (!targetPath) continue;
    if (!pathBelongsToDirectory(targetPath, effectiveDirectory)) {
      errors.push(`${row.filename ?? row.id}: outside backup directory`);
      continue;
    }

    try {
      await unlink(targetPath);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        errors.push(`${row.filename ?? row.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    try {
      await updateBackupRun(row.id, { deleted_at: new Date().toISOString() });
      deletedCount += 1;
    } catch (error) {
      errors.push(`${row.filename ?? row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    deletedCount,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
}

async function syncBackupDirectoryMetadata(config: BackupConfigRow): Promise<void> {
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  const validation = await validateBackupDirectory(effectiveDirectory);
  if (!validation.ok) return;

  let files: string[] = [];
  try {
    files = (await readdir(validation.resolvedPath)).filter((file) => file.endsWith(".sql.gz") && file.startsWith("blindspot"));
  } catch {
    return;
  }

  const existing = await listBackupRuns(BACKUP_SYNC_LIMIT, false);
  const existingByPath = new Map(existing.filter((row) => row.path).map((row) => [row.path as string, row]));

  for (const filename of files) {
    const path = resolve(validation.resolvedPath, filename);
    if (existingByPath.has(path)) continue;

    try {
      const stats = await stat(path);
      const timestamp = inferTimestampFromFilename(filename, stats.mtime.toISOString());
      await insertBackupRun({
        trigger: inferTriggerFromFilename(filename),
        purpose: inferPurposeFromFilename(filename),
        status: "completed",
        path,
        filename,
        created_at: timestamp,
        completed_at: timestamp,
        size_bytes: stats.size,
        error_message: null,
        cleanup_deleted_count: 0,
        cleanup_error_message: null,
        deleted_at: null,
      });
    } catch {
      // Ignore sync failures; overview and explicit operations surface errors separately.
    }
  }
}

async function runBackupInternal(options: { trigger: BackupTrigger; purpose?: BackupPurpose; tag?: string }): Promise<BackupRunRow> {
  const config = await fetchBackupConfig();
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  const run = await insertBackupRun({ trigger: options.trigger, purpose: options.purpose ?? "standard", status: "running" });
  const now = new Date().toISOString();
  await patchBackupConfig({
    last_started_at: now,
    last_error_at: null,
    last_error_message: null,
  });

  const validation = await validateBackupDirectory(effectiveDirectory);
  if (!validation.ok) {
    return markBackupFailure(run.id, validation.message ?? "Invalid backup directory");
  }

  try {
    const { stdout, stderr } = await runScript(BACKUP_SCRIPT_PATH, {
      ...process.env,
      BLINDSPOT_BACKUP_DIR: validation.resolvedPath,
      BACKUP_TAG: options.tag ?? options.trigger,
    });

    const parsed = parseBackupScriptOutput(`${stdout}\n${stderr}`);
    const completedAt = new Date().toISOString();
    await updateBackupRun(run.id, {
      status: "completed",
      path: parsed.path,
      filename: basename(parsed.path),
      completed_at: completedAt,
      size_bytes: parsed.sizeBytes,
    });

    const refreshedConfig = await fetchBackupConfig();
    const retention = await applyRetention(refreshedConfig);
    await patchBackupConfig({
      last_completed_at: completedAt,
      last_successful_at: completedAt,
      last_error_at: retention.errorMessage ? completedAt : null,
      last_error_message: retention.errorMessage,
    });

    return updateBackupRun(run.id, {
      cleanup_deleted_count: retention.deletedCount,
      cleanup_error_message: retention.errorMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup command failed";
    return markBackupFailure(run.id, message);
  }
}

export async function runBackup(trigger: BackupTrigger): Promise<BackupRunRow> {
  if (activeBackupExecution || activeRestoreExecution) {
    throw new BackupOperationError("backup_already_running", "A backup or restore is already running", 409);
  }

  activeBackupExecution = runBackupInternal({ trigger, purpose: "standard" }).finally(() => {
    activeBackupExecution = null;
  });

  return activeBackupExecution;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function finalizeRestoreSuccess(input: {
  sourceBackup: BackupRunRow;
  checkpointBackup: BackupRunRow;
  startedAt: string;
  maintenanceStartedAt: string;
  triggeredByUserId: string;
}) {
  await patchBackupConfig({
    maintenance_mode: false,
    maintenance_started_at: null,
    restore_completed_at: new Date().toISOString(),
    restore_error_at: null,
    restore_error_message: null,
  });

  await syncBackupDirectoryMetadata(await fetchBackupConfig());
  await ensureBackupRunPersisted(input.sourceBackup);
  await ensureBackupRunPersisted(input.checkpointBackup);

  const completedAt = new Date().toISOString();
  const restore = await insertBackupRestore({
    backup_run_id: input.sourceBackup.id,
    checkpoint_backup_run_id: input.checkpointBackup.id,
    status: "completed",
    backup_path: input.sourceBackup.path,
    backup_filename: input.sourceBackup.filename,
    checkpoint_path: input.checkpointBackup.path,
    checkpoint_filename: input.checkpointBackup.filename,
    started_at: input.startedAt,
    completed_at: completedAt,
    error_message: null,
    triggered_by_user_id: input.triggeredByUserId,
    maintenance_started_at: input.maintenanceStartedAt,
    maintenance_finished_at: completedAt,
  });

  activeRestoreState = {
    ...activeRestoreState!,
    status: "completed",
    completed_at: completedAt,
    error_message: null,
  };

  return restore;
}

async function finalizeRestoreFailure(input: {
  sourceBackup: BackupRunRow;
  checkpointBackup: BackupRunRow | null;
  startedAt: string;
  maintenanceStartedAt: string;
  triggeredByUserId: string;
  message: string;
}): Promise<never> {
  const completedAt = new Date().toISOString();
  try {
    await patchBackupConfig({
      maintenance_mode: false,
      maintenance_started_at: null,
      restore_completed_at: completedAt,
      restore_error_at: completedAt,
      restore_error_message: input.message,
      last_error_at: completedAt,
      last_error_message: input.message,
    });
  } catch {
    // Best effort; DB might be partially restored.
  }

  try {
    if (input.checkpointBackup) {
      await ensureBackupRunPersisted(input.checkpointBackup);
    }
    await ensureBackupRunPersisted(input.sourceBackup);
    await insertBackupRestore({
      backup_run_id: input.sourceBackup.id,
      checkpoint_backup_run_id: input.checkpointBackup?.id ?? null,
      status: "failed",
      backup_path: input.sourceBackup.path,
      backup_filename: input.sourceBackup.filename,
      checkpoint_path: input.checkpointBackup?.path ?? null,
      checkpoint_filename: input.checkpointBackup?.filename ?? null,
      started_at: input.startedAt,
      completed_at: completedAt,
      error_message: input.message,
      triggered_by_user_id: input.triggeredByUserId,
      maintenance_started_at: input.maintenanceStartedAt,
      maintenance_finished_at: completedAt,
    });
  } catch {
    // Best effort only.
  }

  activeRestoreState = {
    status: "failed",
    backup_run_id: input.sourceBackup.id,
    backup_filename: input.sourceBackup.filename,
    checkpoint_backup_run_id: input.checkpointBackup?.id ?? null,
    checkpoint_filename: input.checkpointBackup?.filename ?? null,
    started_at: input.startedAt,
    maintenance_started_at: input.maintenanceStartedAt,
    completed_at: completedAt,
    error_message: input.message,
    triggered_by_user_id: input.triggeredByUserId,
  };

  throw new BackupOperationError(
    input.checkpointBackup ? "restore_failed" : "restore_checkpoint_failed",
    input.message,
    500
  );
}

async function runRestoreInternal(id: string, triggeredByUserId: string): Promise<BackupRestoreRow> {
  const config = await fetchBackupConfig();
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  const validation = await validateBackupDirectory(effectiveDirectory);
  if (!validation.ok) {
    throw new BackupOperationError(validation.errorCode ?? "backup_directory_missing", validation.message ?? "Invalid backup directory", 400);
  }

  const sourceBackup = await fetchBackupRunById(id);
  if (!sourceBackup || sourceBackup.deleted_at || sourceBackup.status !== "completed" || !sourceBackup.path) {
    throw new BackupOperationError("restore_not_found", "Backup cannot be restored", 404);
  }
  if (!pathBelongsToDirectory(sourceBackup.path, validation.resolvedPath)) {
    throw new BackupOperationError("restore_validation_failed", "Backup path is outside the configured directory", 409);
  }
  if (!(await fileExists(sourceBackup.path))) {
    throw new BackupOperationError("restore_file_missing", "Backup file is missing on disk", 404);
  }

  await ensureNoPipelineActivity();

  const startedAt = new Date().toISOString();
  const maintenanceStartedAt = startedAt;
  activeRestoreState = {
    status: "running",
    backup_run_id: sourceBackup.id,
    backup_filename: sourceBackup.filename,
    checkpoint_backup_run_id: null,
    checkpoint_filename: null,
    started_at: startedAt,
    maintenance_started_at: maintenanceStartedAt,
    completed_at: null,
    error_message: null,
    triggered_by_user_id: triggeredByUserId,
  };

  await patchBackupConfig({
    maintenance_mode: true,
    maintenance_started_at: maintenanceStartedAt,
    restore_started_at: startedAt,
    restore_completed_at: null,
    restore_error_at: null,
    restore_error_message: null,
  });

  let checkpointBackup: BackupRunRow | null = null;

  try {
    checkpointBackup = await runBackupInternal({ trigger: "manual", purpose: "restore_checkpoint", tag: "restore-checkpoint" });
    activeRestoreState = {
      ...activeRestoreState,
      checkpoint_backup_run_id: checkpointBackup.id,
      checkpoint_filename: checkpointBackup.filename,
    };

    if (checkpointBackup.status !== "completed" || !checkpointBackup.path) {
      throw new Error(checkpointBackup.error_message ?? "Checkpoint backup failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create restore checkpoint";
    await finalizeRestoreFailure({
      sourceBackup,
      checkpointBackup,
      startedAt,
      maintenanceStartedAt,
      triggeredByUserId,
      message,
    });
    throw error;
  }

  try {
    const { stdout, stderr } = await runScript(RESTORE_SCRIPT_PATH, {
      ...process.env,
      BLINDSPOT_RESTORE_FILE: sourceBackup.path,
      BLINDSPOT_DB_CONTAINER: process.env["BLINDSPOT_DB_CONTAINER"] ?? "supabase_db_gap-radar",
      BLINDSPOT_REPO_ROOT: REPO_ROOT,
    }, RESTORE_TIMEOUT_MS);
    parseRestoreScriptOutput(`${stdout}\n${stderr}`);
    return await finalizeRestoreSuccess({
      sourceBackup,
      checkpointBackup,
      startedAt,
      maintenanceStartedAt,
      triggeredByUserId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore command failed";
    return finalizeRestoreFailure({
      sourceBackup,
      checkpointBackup,
      startedAt,
      maintenanceStartedAt,
      triggeredByUserId,
      message,
    });
  }
}

export async function restoreBackup(id: string, triggeredByUserId: string): Promise<BackupRestoreRow> {
  if (activeBackupExecution || activeRestoreExecution) {
    throw new BackupOperationError("restore_already_running", "A backup or restore is already running", 409);
  }

  activeRestoreExecution = runRestoreInternal(id, triggeredByUserId).finally(() => {
    activeRestoreExecution = null;
    if (activeRestoreState?.status !== "running") {
      activeRestoreState = null;
    }
  });

  return activeRestoreExecution;
}

export function getActiveRestoreState(): RestoreRuntimeState | null {
  return activeRestoreState;
}

export async function listBackupRuns(limit = 100, sync = true): Promise<BackupRunRow[]> {
  const db = getDb();
  if (sync) {
    try {
      await syncBackupDirectoryMetadata(await fetchBackupConfig());
    } catch {
      // best effort
    }
  }
  const { data, error } = await db
    .from("backup_runs")
    .select("id, trigger, purpose, status, path, filename, created_at, completed_at, size_bytes, error_message, cleanup_deleted_count, cleanup_error_message, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(asBackupRunRow);
}

export async function deleteBackup(id: string): Promise<{ id: string; deleted_at: string }> {
  const row = await fetchBackupRunById(id);
  if (!row) {
    throw new BackupOperationError("backup_not_found", "Backup not found", 404);
  }
  if (row.deleted_at || row.status === "running" || !row.path) {
    throw new BackupOperationError("backup_delete_forbidden", "Backup cannot be deleted", 409);
  }
  if (activeRestoreExecution) {
    throw new BackupOperationError("backup_delete_forbidden", "Backups cannot be deleted during restore maintenance", 409);
  }

  const config = await fetchBackupConfig();
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  if (!pathBelongsToDirectory(row.path, effectiveDirectory)) {
    throw new BackupOperationError("backup_delete_forbidden", "Backup path is outside the configured directory", 409);
  }

  try {
    await unlink(row.path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new BackupOperationError(
        "backup_delete_failed",
        error instanceof Error ? error.message : "Unable to delete backup",
        500
      );
    }
  }

  const deletedAt = new Date().toISOString();
  await updateBackupRun(row.id, { deleted_at: deletedAt });
  return { id: row.id, deleted_at: deletedAt };
}

export async function buildBackupOverview(scheduler: BackupSchedulerSnapshot): Promise<BackupOverview> {
  const config = await fetchBackupConfig();
  await syncBackupDirectoryMetadata(config);
  const recent = await listBackupRuns(100, false);
  const restores = await listBackupRestores();
  const effectiveDirectory = getEffectiveBackupDirectory(config);
  const validation = await validateBackupDirectory(effectiveDirectory);
  const lastBackup = recent[0] ?? null;
  const lastRestore = restores[0] ?? null;
  const alerts: string[] = [];
  const retention = getRetentionSummary(config);
  const manualBackups = recent.filter((row) => row.trigger === "manual");
  const scheduledBackups = recent.filter((row) => row.trigger === "scheduled");
  const restoreCheckpoints = manualBackups.filter((row) => row.purpose === "restore_checkpoint");
  const databaseSizeBytes = await fetchDatabaseSizeBytes();
  const storedBackupSizeByTrigger = {
    manual: manualBackups.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0),
    scheduled: scheduledBackups.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0),
  };
  const storedBackupSizeBytes = storedBackupSizeByTrigger.manual + storedBackupSizeByTrigger.scheduled;

  if (!validation.ok) alerts.push("backup_directory_invalid");
  if (config.last_error_at && (!config.last_successful_at || config.last_error_at >= config.last_successful_at)) {
    alerts.push("backup_recent_failure");
  }
  if (
    config.enabled &&
    !config.maintenance_mode &&
    (!config.scheduler_heartbeat_at || Date.now() - new Date(config.scheduler_heartbeat_at).getTime() > BACKUP_SCHEDULER_STALE_MS)
  ) {
    alerts.push("backup_scheduler_stale");
  }
  if (lastBackup?.cleanup_error_message) alerts.push("backup_retention_error");
  if (config.maintenance_mode || activeRestoreState?.status === "running") alerts.push("backup_restore_in_progress");
  if (config.restore_error_at && (!config.restore_completed_at || config.restore_error_at >= config.restore_completed_at)) {
    alerts.push("backup_restore_failed");
  }

  return {
    config: {
      ...config,
      effective_directory: validation.resolvedPath,
      directory_valid: validation.ok,
      directory_error: validation.message,
    },
    scheduler,
    summary: {
      last_backup: lastBackup,
      next_backup_at: config.scheduled_for,
      backup_count: recent.filter((row) => !row.deleted_at).length,
      max_backups: config.max_backups,
      manual_backup_count: manualBackups.length,
      scheduled_backup_count: scheduledBackups.length,
      restore_checkpoint_count: restoreCheckpoints.length,
      retention: {
        manual: { count: manualBackups.length, max: retention.manual.max },
        scheduled: { count: scheduledBackups.length, max: retention.scheduled.max },
      },
      database_size_bytes: databaseSizeBytes,
      stored_backup_size_bytes: storedBackupSizeBytes,
      stored_backup_size_by_trigger: storedBackupSizeByTrigger,
      last_restore: lastRestore,
    },
    restore: {
      active: activeRestoreState,
      last_restore: lastRestore,
    },
    alerts,
    recent,
  };
}

export function getDefaultBackupSchedulerSnapshot(): BackupSchedulerSnapshot {
  return {
    started: false,
    cron_active: false,
    status: "stopped",
    last_reload_at: null,
    last_tick_at: null,
    last_error_at: null,
    last_error_message: null,
  };
}

export function getNextBackupScheduledFor(enabled: boolean, cronExpression: string | null): string | null {
  if (!enabled || !cronExpression) return null;
  return parseCronExpression(cronExpression).toISOString();
}

export { DEFAULT_CRON, DEFAULT_MAX_BACKUPS, MAX_BACKUPS_LIMIT };
