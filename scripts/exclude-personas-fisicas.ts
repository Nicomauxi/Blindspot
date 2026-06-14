// Ley 18.331 — excluye del pool los leads que son (probable) persona física, retroactivamente.
// Alcance: fuentes externas cuyo nombre es razón social / nombre de persona (yelu/mintur/osm/miem_dei).
// NO toca google_places (su "nombre" es un nombre comercial de Maps → la heurística es ruidosa ahí).
// Uso:
//   node --env-file=.env --import tsx/esm scripts/exclude-personas-fisicas.ts            (dry-run)
//   node --env-file=.env --import tsx/esm scripts/exclude-personas-fisicas.ts --apply    (persiste)
import { getSupabase } from "../src/shared/supabase.js";
import { classifyLegalPersonType } from "../src/modules/discovery/person-classifier.js";
import { personaFisicaRedaction } from "../src/modules/discovery/persona-fisica.js";
import { getLogger } from "../src/shared/logger.js";

const EXTERNAL_NAME_SOURCES = ["yelu", "mintur", "osm", "miem_dei"];
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const log = getLogger();
  const db = getSupabase();

  // Escanea TODAS las fuentes externas (no solo passed): así también minimiza+flaggea las que ya
  // se excluyeron antes pero todavía conservan datos personales. Idempotente. Pagina con range()
  // para superar el tope de 1000 filas de PostgREST.
  type Row = { id: string; name: string | null; source: string; tags: string[] | null; rejection_reasons: string[] | null };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, source, tags, rejection_reasons")
      .in("source", EXTERNAL_NAME_SOURCES)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const fisicas = rows.filter((r) => classifyLegalPersonType(r.name) === "fisica");

  const bySource: Record<string, number> = {};
  for (const r of fisicas) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  // No imprimir nombres (datos personales) a stdout/logs (Ley 18.331): solo conteos.
  log.info({ scanned: rows.length, fisicas: fisicas.length, bySource, apply: APPLY }, "persona-fisica retroactive exclusion");
  console.log(`\nEscaneados (fuentes externas): ${rows.length}`);
  console.log(`Personas físicas detectadas: ${fisicas.length}`);
  console.log(`Por fuente:`, bySource);

  if (!APPLY) {
    console.log(`\n[dry-run] No se persistió nada. Re-correr con --apply para excluir + minimizar datos.`);
    return;
  }

  let updated = 0;
  for (const r of fisicas) {
    const tags = Array.from(new Set([...(r.tags ?? []), "persona-fisica", "rejected:persona-fisica"]));
    const reasons = Array.from(new Set([...(r.rejection_reasons ?? []), "persona-fisica"]));
    const { error: upErr } = await db
      .from("leads")
      // Oculta (passed_filter=false), marca is_natural_person y MINIMIZA datos personales.
      .update({ passed_filter: false, tags, rejection_reasons: reasons, ...personaFisicaRedaction() })
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
