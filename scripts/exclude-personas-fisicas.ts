// Ley 18.331 — excluye del pool los leads que son (probable) persona física, retroactivamente.
// Alcance: fuentes externas cuyo nombre es razón social / nombre de persona (yelu/mintur/osm/miem_dei).
// NO toca google_places (su "nombre" es un nombre comercial de Maps → la heurística es ruidosa ahí).
// Uso:
//   node --env-file=.env --import tsx/esm scripts/exclude-personas-fisicas.ts            (dry-run)
//   node --env-file=.env --import tsx/esm scripts/exclude-personas-fisicas.ts --apply    (persiste)
import { getSupabase } from "../src/shared/supabase.js";
import { classifyLegalPersonType } from "../src/modules/discovery/person-classifier.js";
import { getLogger } from "../src/shared/logger.js";

const EXTERNAL_NAME_SOURCES = ["yelu", "mintur", "osm", "miem_dei"];
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const log = getLogger();
  const db = getSupabase();

  const { data, error } = await db
    .from("leads")
    .select("id, name, source, tags, rejection_reasons")
    .in("source", EXTERNAL_NAME_SOURCES)
    .eq("passed_filter", true);
  if (error) throw new Error(`load failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; name: string | null; source: string; tags: string[] | null; rejection_reasons: string[] | null }>;
  const fisicas = rows.filter((r) => classifyLegalPersonType(r.name) === "fisica");

  const bySource: Record<string, number> = {};
  for (const r of fisicas) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  log.info({ scanned: rows.length, fisicas: fisicas.length, bySource, apply: APPLY }, "persona-fisica retroactive exclusion");
  console.log(`\nEscaneados (passed, fuentes externas): ${rows.length}`);
  console.log(`Personas físicas detectadas: ${fisicas.length}`);
  console.log(`Por fuente:`, bySource);
  console.log(`Muestra:\n${fisicas.slice(0, 20).map((r) => `  ${r.source}: ${r.name}`).join("\n")}`);

  if (!APPLY) {
    console.log(`\n[dry-run] No se persistió nada. Re-correr con --apply para excluir.`);
    return;
  }

  let updated = 0;
  for (const r of fisicas) {
    const tags = Array.from(new Set([...(r.tags ?? []), "persona-fisica", "rejected:persona-fisica"]));
    const reasons = Array.from(new Set([...(r.rejection_reasons ?? []), "persona-fisica"]));
    const { error: upErr } = await db
      .from("leads")
      .update({ passed_filter: false, tags, rejection_reasons: reasons })
      .eq("id", r.id);
    if (upErr) {
      log.warn({ id: r.id, error: upErr.message }, "update failed");
      continue;
    }
    updated++;
  }
  console.log(`\nExcluidos: ${updated}/${fisicas.length}`);
  log.info({ updated }, "persona-fisica exclusion applied");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
