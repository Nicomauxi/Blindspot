// Comando CLI: enriquecer perfiles de Instagram vía Graph API business_discovery
// (vía oficial, gratis, sin login wall). Inactivo si faltan META_IG_USER_ID / META_GRAPH_TOKEN.
// Crea un run kind "social" para que quede visible en el Estado del run unificado.
import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { completeRun, createSocialEnrichRun, failRun, getRunById } from "../../storage/runs.js";
import { isGraphApiEnabled } from "../../modules/social-enrich/graph-api.js";
import { runInstagramGraphEnrich } from "../../modules/social-enrich/graph-enrich.js";
import type { Run } from "../../shared/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ArgsSchema = z
  .object({
    run: z.string().regex(UUID_RE, "run must be a UUID").optional(),
    all: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if ([data.run !== undefined, data.all === true].filter(Boolean).length !== 1) {
      ctx.addIssue({ code: "custom", message: "provide exactly one of --run or --all", path: ["run"] });
    }
  });

interface RawArgs {
  run?: string;
  all?: boolean | string;
  limit?: string | number;
}

export async function igGraphEnrichCommand(rawArgs: RawArgs): Promise<void> {
  const log = getLogger();

  if (!isGraphApiEnabled()) {
    log.error(
      "Instagram Graph API inactiva: configurá META_IG_USER_ID y META_GRAPH_TOKEN en .env antes de correr este comando."
    );
    process.exit(1);
    return;
  }

  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`).join("\n");
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

  const socialRun = await createSocialEnrichRun({
    scope: opts.run ? "run" : "all",
    ...(sourceRun ? { sourceRun } : {}),
    limit: opts.limit ?? 0,
    force: false,
  });
  const startedAt = Date.now();

  try {
    const stats = await runInstagramGraphEnrich({
      ...(opts.run ? { run: opts.run } : { all: true }),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });

    await completeRun(socialRun.id, {
      command: "ig-graph-enrich",
      ...stats,
      duration_ms: Date.now() - startedAt,
    } as never);

    console.log(`
Instagram Graph enrich completado.
Candidatos cargados:   ${stats.loaded}
Seleccionados (c/IG):  ${stats.selected}
Enriquecidos:          ${stats.enriched}
Cuenta no profesional: ${stats.not_professional}
No encontrados:        ${stats.not_found}
Rate-limited:          ${stats.rate_limited}
Errores:               ${stats.errors}
`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(socialRun.id, msg, Date.now() - startedAt).catch(() => undefined);
    throw err;
  }
}
