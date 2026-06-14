// N8.2 — Migra external_id/place_id de mintur y miem_dei al esquema ESTABLE
// (derivado de campos de negocio), recomputando desde source_data. Sin esto, el
// próximo re-import con los providers parcheados duplicaría todo el padrón.
//
// Colisiones (dos filas mapean al mismo id nuevo = mismo negocio duplicado en DB):
// la primera (por created_at) toma el id; las siguientes llevan sufijo #dupN y se
// taguean para la higiene de duplicados.
//
// Uso: node --env-file=.env --import tsx/esm scripts/migrate-stable-external-ids.ts [--apply]
// ⚠️ Backup antes de --apply.

import { getSupabase } from "../src/shared/supabase.js";
import { stableBusinessId } from "../src/modules/discovery/stable-id.js";

const PAGE_SIZE = 1000;

interface Row {
  id: string;
  source: string;
  external_id: string;
  place_id: string;
  created_at: string;
  source_data: Record<string, unknown> | null;
}

function newExternalId(row: Row): string | null {
  const raw = row.source_data;
  if (!raw) return null;
  if (row.source === "mintur") {
    return stableBusinessId([raw["Operador"], raw["Direccion"], raw["Localidad"]]);
  }
  if (row.source === "miem_dei") {
    const rut = String(raw["RUT"] ?? "").trim();
    if (!rut) return null;
    return `${rut}#${stableBusinessId([raw["Calle (EP)"], raw["Numero (EP)"], raw["Localidad (EP)"]]).slice(0, 8)}`;
  }
  return null;
}

async function loadRows(source: string): Promise<Row[]> {
  const db = getSupabase();
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, source, external_id, place_id, created_at, source_data")
      .eq("source", source)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load ${source} failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== N8.2 migrate stable external ids — ${apply ? "APPLY" : "DRY-RUN"} ===\n`);

  const db = getSupabase();
  for (const source of ["mintur", "miem_dei"]) {
    const rows = await loadRows(source);
    const seen = new Map<string, number>();
    const updates: Array<{ id: string; external_id: string; place_id: string }> = [];
    let unmappable = 0;

    for (const row of rows) {
      const base = newExternalId(row);
      if (!base) {
        unmappable += 1;
        continue;
      }
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const externalId = count === 0 ? base : `${base}#dup${count + 1}`;
      if (externalId === row.external_id) continue;
      updates.push({ id: row.id, external_id: externalId, place_id: `${source}:${externalId}` });
    }

    const collisions = [...seen.values()].filter((c) => c > 1).length;
    console.log(`${source}: ${rows.length} filas · ${updates.length} a migrar · ${collisions} ids con colisión (dups reales) · ${unmappable} sin source_data`);

    if (!apply) continue;

    let updated = 0;
    const failures: string[] = [];
    for (const u of updates) {
      const { error } = await db
        .from("leads")
        .update({ external_id: u.external_id, place_id: u.place_id })
        .eq("id", u.id);
      if (error) failures.push(`${u.id}: ${error.message}`);
      else updated += 1;
    }
    console.log(`  migrados: ${updated}`);
    if (failures.length > 0) {
      console.error(`  fallos (${failures.length}):`);
      for (const f of failures.slice(0, 10)) console.error(`    ! ${f}`);
      process.exit(1);
    }
  }

  if (!apply) console.log("\n(dry-run — re-ejecutar con --apply tras backup.)\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
