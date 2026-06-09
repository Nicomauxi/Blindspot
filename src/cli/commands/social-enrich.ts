import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { completeRun, createSocialEnrichRun, failRun, getRunById } from "../../storage/runs.js";
import { runSocialEnrich } from "../../modules/social-enrich/index.js";
import type { Run } from "../../shared/types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE, "run must be a UUID").optional(),
    all: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).default(10),
    force: z.coerce.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    const scopes = [data.run !== undefined, data.all === true].filter(Boolean).length;
    if (scopes !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "provide exactly one of --run or --all",
        path: ["run"],
      });
    }
  });

interface RawArgs {
  run?: string;
  all: boolean | string;
  limit: string | number;
  force: boolean | string;
}

export async function socialEnrichCommand(rawArgs: RawArgs): Promise<void> {
  const log = getLogger();
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
    return;
  }
  const opts = parsed.data;

  let sourceRun: Run | undefined;
  if (opts.run) {
    const found = await getRunById(opts.run);
    if (!found) {
      log.error({ runId: opts.run }, "Source run not found");
      process.exit(1);
      return;
    }
    sourceRun = found;
  }

  // Run trackeado (kind "social") para el Estado del run unificado.
  const socialRun = await createSocialEnrichRun({
    scope: opts.run ? "run" : "all",
    ...(sourceRun ? { sourceRun } : {}),
    limit: opts.limit,
    force: opts.force,
  });
  const startedAt = Date.now();

  try {
    const stats = await runSocialEnrich({
      ...(opts.run ? { run: opts.run } : { all: true }),
      limit: opts.limit,
      force: opts.force,
    });

    await completeRun(socialRun.id, {
      command: "social-enrich",
      loaded: stats.loaded,
      selected: stats.selected,
      processed: stats.processed,
      skipped_fresh: stats.skippedFresh,
      errors: stats.errors,
      blocked: stats.blocked,
      duration_ms: Date.now() - startedAt,
    } as never);

    console.log(`
Social enrich completado.
Candidatos cargados: ${stats.loaded}
Seleccionados:       ${stats.selected}
Procesados:          ${stats.processed}
Saltados fresh:      ${stats.skippedFresh}
Errores:             ${stats.errors}
`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(socialRun.id, msg, Date.now() - startedAt).catch(() => undefined);
    throw err;
  }
}
