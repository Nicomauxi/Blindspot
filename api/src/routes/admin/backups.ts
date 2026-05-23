import cron from "node-cron";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthUser, requireAdmin } from "../../auth/middleware.js";
import {
  DEFAULT_MAX_BACKUPS,
  MAX_BACKUPS_LIMIT,
  BackupOperationError,
  fetchBackupConfig,
  getNextBackupScheduledFor,
  patchBackupConfig,
  runBackup,
  restoreBackup,
  validateBackupDirectory,
  deleteBackup,
} from "../../modules/backups/service.js";
import { getBackupScheduler } from "../../modules/backups/runtime.js";

const updateBackupConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cron_expression: z.string().trim().min(1).optional(),
  directory: z.string().trim().min(1).nullable().optional(),
  max_backups: z.number().int().min(1).max(MAX_BACKUPS_LIMIT).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const restoreBackupBodySchema = z.object({
  confirmation: z.literal("RESTORE"),
});

function replyBackupError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof BackupOperationError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      error_code: error.errorCode,
    });
  }

  return reply.status(500).send({
    error: error instanceof Error ? error.message : "Unexpected backup error",
    error_code: "backup_failed",
  });
}

export async function backupsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/backups", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const overview = await getBackupScheduler().getOverview();
      return reply.status(200).send({ data: overview });
    } catch (error) {
      return replyBackupError(reply, error);
    }
  });

  app.patch("/admin/backups/config", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = updateBackupConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const current = await fetchBackupConfig();
      const nextEnabled = parsed.data.enabled ?? current.enabled;
      const nextCron = parsed.data.cron_expression ?? current.cron_expression;
      const nextDirectory = parsed.data.directory === undefined ? current.directory : parsed.data.directory;
      const nextMaxBackups = parsed.data.max_backups ?? current.max_backups ?? DEFAULT_MAX_BACKUPS;
      const effectiveDirectory = (nextDirectory ?? "").trim().length > 0 ? nextDirectory : null;
      const resolvedDirectory = effectiveDirectory ?? current.directory ?? null;

      if (resolvedDirectory) {
        const validation = await validateBackupDirectory(resolvedDirectory);
        if (!validation.ok) {
          throw new BackupOperationError(validation.errorCode ?? "backup_directory_missing", validation.message ?? "Invalid backup directory", 400);
        }
      }

      if (parsed.data.cron_expression !== undefined && !cron.validate(nextCron)) {
        throw new BackupOperationError("invalid_cron_expression", "Invalid cron expression", 400);
      }

      const updated = await patchBackupConfig({
        enabled: nextEnabled,
        cron_expression: nextCron,
        directory: effectiveDirectory,
        max_backups: nextMaxBackups,
        scheduled_for: getNextBackupScheduledFor(nextEnabled, nextCron),
      });

      const overview = await getBackupScheduler().getOverview();
      return reply.status(200).send({ data: { config: updated, overview } });
    } catch (error) {
      return replyBackupError(reply, error);
    }
  });

  app.post("/admin/backups/run", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const run = await runBackup("manual");
      return reply.status(202).send({ data: run });
    } catch (error) {
      return replyBackupError(reply, error);
    }
  });

  app.post("/admin/backups/:id/restore", { preHandler: requireAdmin }, async (request, reply) => {
    const idParsed = idParamSchema.safeParse(request.params);
    const bodyParsed = restoreBackupBodySchema.safeParse(request.body ?? {});
    if (!idParsed.success || !bodyParsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: {
          ...(idParsed.success ? {} : idParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const actor = getAuthUser(request);
      const restore = await restoreBackup(idParsed.data.id, actor.id);
      return reply.status(202).send({ data: restore });
    } catch (error) {
      return replyBackupError(reply, error);
    }
  });

  app.delete("/admin/backups/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await deleteBackup(parsed.data.id);
      return reply.status(200).send({ data: result });
    } catch (error) {
      return replyBackupError(reply, error);
    }
  });
}
