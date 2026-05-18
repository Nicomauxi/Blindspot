// CLI command: blindspot enrich-tipo-operador
// Backfills tipo_operador from MINTUR source_data for all MINTUR leads.

import { getLogger } from "../../shared/logger.js";
import { getSupabase } from "../../shared/supabase.js";
import { updateLeadCompanyData } from "../../storage/leads.js";
import { parseTipoOperador } from "../../modules/enrichment/parsers/mintur-tipo-operador.js";

const log = getLogger();

export interface EnrichTipoOperadorArgs {
  dryRun: boolean;
}

export async function enrichTipoOperadorCommand(args: EnrichTipoOperadorArgs): Promise<void> {
  const { dryRun } = args;
  const db = getSupabase();

  const { data: leads, error } = await db
    .from("leads")
    .select("id, source_data, lead_company_data")
    .eq("source", "mintur")
    .is("lead_company_data->>'tipo_operador'", null)
    .limit(5000);

  if (error) throw new Error(`Failed to load MINTUR leads: ${error.message}`);

  const rows = leads ?? [];
  log.info({ total: rows.length, dryRun }, "MINTUR TipoOperador backfill started");

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const parsed = parseTipoOperador(row.source_data as Record<string, unknown> | null);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      await updateLeadCompanyData(row.id, {
        tipo_operador: parsed.tipo_operador,
        tipo_operador_sub_niche: parsed.tipo_operador_sub_niche,
      });
    }
    updated++;
    log.debug({ leadId: row.id, tipo: parsed.tipo_operador, sub_niche: parsed.tipo_operador_sub_niche }, "tipo_operador set");
  }

  log.info({ total: rows.length, updated, skipped, dryRun }, "MINTUR TipoOperador backfill complete");
}
