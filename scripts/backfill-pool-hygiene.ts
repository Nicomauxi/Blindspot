// F5 — Higiene de pool. Backfills idempotentes, dry-run por defecto.
//   F5.1: leads con tag 'duplicate-secondary' y passed_filter=true → fuera del pool
//         (passed_filter=false + rejection_reason 'duplicate-secondary').
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/backfill-pool-hygiene.ts [--apply]
//
// ⚠️ Mutación masiva: correr `bash scripts/backup.sh` antes de --apply.

import { getSupabase } from "../src/shared/supabase.js";

const PAGE_SIZE = 1000;

interface Row {
  id: string;
  name: string;
  rejection_reasons: string[] | null;
}

async function loadPooledDuplicateSecondaries(): Promise<Row[]> {
  const db = getSupabase();
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, rejection_reasons")
      .contains("tags", ["duplicate-secondary"])
      .eq("passed_filter", true)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load duplicate-secondary failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== F5.1 backfill pool-hygiene — ${apply ? "APPLY" : "DRY-RUN"} ===\n`);

  const rows = await loadPooledDuplicateSecondaries();
  console.log(`duplicate-secondary en pool: ${rows.length}`);
  for (const r of rows.slice(0, 10)) console.log(`  - ${r.id} ${r.name}`);

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply.)\n");
    return;
  }

  const db = getSupabase();
  let updated = 0;
  const failures: string[] = [];
  for (const r of rows) {
    const reasons = Array.from(new Set([...(r.rejection_reasons ?? []), "duplicate-secondary"]));
    const { error } = await db
      .from("leads")
      .update({ passed_filter: false, rejection_reasons: reasons })
      .eq("id", r.id);
    if (error) failures.push(`${r.id}: ${error.message}`);
    else updated++;
  }

  console.log(`\nActualizados: ${updated}`);
  if (failures.length > 0) {
    console.error(`Fallos (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.error(`  ! ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
