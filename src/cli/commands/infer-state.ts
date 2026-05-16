import { z } from "zod";
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import { computeInferredState } from "../../modules/enrichment/inferred-state.js";
import { loadAllLeads, patchLeadInferredState } from "../../storage/leads.js";
import type { DigitalFootprintEnriched, Lead } from "../../shared/types.js";

const ArgsSchema = z
  .object({
    all: z.coerce.boolean().default(false),
    passedOnly: z.coerce.boolean().default(true),
    force: z.coerce.boolean().default(false),
    concurrency: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((data, ctx) => {
    if (!data.all) {
      ctx.addIssue({
        code: "custom",
        message: "provide --all (required)",
        path: ["all"],
      });
    }
  });

interface RawArgs {
  all: boolean | string;
  passedOnly: boolean | string;
  force: boolean | string;
  concurrency: string | number;
}

function shouldProcess(lead: Lead, opts: { passedOnly: boolean; force: boolean }): boolean {
  if (!lead.passed_filter && opts.passedOnly) return false;
  if (!lead.digital_footprint || lead.digital_footprint.skipped === true) return false;
  if (!opts.force) {
    const fp = lead.digital_footprint as DigitalFootprintEnriched;
    const existing = fp.inferred_state?.computed_at;
    if (existing && Date.now() - Date.parse(existing) < 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

export async function inferStateCommand(rawArgs: RawArgs): Promise<void> {
  const log = getLogger();
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }
  const opts = parsed.data;

  const leads = await loadAllLeads();
  const selected = leads.filter((lead) =>
    shouldProcess(lead, { passedOnly: opts.passedOnly, force: opts.force })
  );

  log.info(
    {
      force: opts.force,
      passedOnly: opts.passedOnly,
      loaded: leads.length,
      selected: selected.length,
      concurrency: opts.concurrency,
    },
    "Starting infer-state"
  );

  const limit = pLimit(opts.concurrency);
  let processed = 0;
  let errors = 0;

  const levelCounts: Record<"none" | "basic" | "intermediate" | "advanced", number> = {
    none: 0,
    basic: 0,
    intermediate: 0,
    advanced: 0,
  };

  await Promise.all(
    selected.map((lead) =>
      limit(async () => {
        try {
          const fp = lead.digital_footprint as DigitalFootprintEnriched;
          const inferred = computeInferredState(fp, lead);
          fp.inferred_state = inferred;
          await patchLeadInferredState(lead.id, fp);
          levelCounts[inferred.digitalization_level] += 1;
          processed += 1;
          log.info(
            {
              leadId: lead.id,
              level: inferred.digitalization_level,
            },
            "infer-state processed lead"
          );
        } catch (err: unknown) {
          errors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ leadId: lead.id, err: msg }, "infer-state failed for lead");
        }
      })
    )
  );

  console.log(`
Infer-state completado.
Candidatos cargados: ${leads.length}
Seleccionados:       ${selected.length}
Procesados:          ${processed}
Errores:             ${errors}

Distribución digitalization_level:
  none:         ${levelCounts["none"]}
  basic:        ${levelCounts["basic"]}
  intermediate: ${levelCounts["intermediate"]}
  advanced:     ${levelCounts["advanced"]}
`);
}
