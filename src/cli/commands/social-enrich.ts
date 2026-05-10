import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { getRunById } from "../../storage/runs.js";
import { runSocialEnrich } from "../../modules/social-enrich/index.js";

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

  if (opts.run) {
    const sourceRun = await getRunById(opts.run);
    if (!sourceRun) {
      log.error({ runId: opts.run }, "Source run not found");
      process.exit(1);
      return;
    }
  }

  const stats = await runSocialEnrich({
    ...(opts.run ? { run: opts.run } : { all: true }),
    limit: opts.limit,
    force: opts.force,
  });

  console.log(`
Social enrich completado.
Candidatos cargados: ${stats.loaded}
Seleccionados:       ${stats.selected}
Procesados:          ${stats.processed}
Saltados fresh:      ${stats.skippedFresh}
Errores:             ${stats.errors}
`);
}
