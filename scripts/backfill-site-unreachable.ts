// Backfill: limpiar el tag stale `site-unreachable` de leads cuyo sitio NO está
// genuinamente ausente. Recalcula desde el digital_footprint YA almacenado — SIN red.
//
// Contexto: antes cualquier fetch_error marcaba site-unreachable. 510 leads del pool
// quedaron mal tagueados (sitios operativos bloqueados por bot/timeout/5xx, o tags
// stale tras un re-fetch exitoso). El fix de algoritmo ya está en cleanupMergedTags...;
// este script lo aplica a los datos existentes.
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/backfill-site-unreachable.ts [--apply]
//
// ⚠️ Mutación: correr `bash scripts/backup.sh` antes de --apply. Tras aplicar, conviene
//    re-scorear los leads afectados (site-unreachable mueve sub-scores +15 y la oferta).

import { getSupabase } from "../src/shared/supabase.js";
import { isWebsiteGenuinelyMissing } from "../src/modules/enrichment/fetch-error.js";

const PAGE_SIZE = 1000;
const APPLY = process.argv.includes("--apply");

interface Row {
  id: string;
  name: string;
  tags: string[];
  digital_footprint: { fetch_error?: string } | null;
}

async function main(): Promise<void> {
  const db = getSupabase();
  const affected: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, tags, digital_footprint")
      .contains("tags", ["site-unreachable"])
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    const batch = (data ?? []) as Row[];
    affected.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const toClean = affected.filter(
    (r) => !isWebsiteGenuinelyMissing(r.digital_footprint?.fetch_error)
  );
  const genuinelyMissing = affected.length - toClean.length;

  console.log(`site-unreachable total: ${affected.length}`);
  console.log(`  genuinamente ausente (404/410/invalid-domain, se mantiene): ${genuinelyMissing}`);
  console.log(`  tag stale a limpiar: ${toClean.length}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nada modificado. Correr con --apply para persistir.");
    return;
  }

  let cleaned = 0;
  for (const row of toClean) {
    const nextTags = row.tags.filter((t) => t !== "site-unreachable");
    const { error } = await db.from("leads").update({ tags: nextTags }).eq("id", row.id);
    if (error) {
      console.error(`  ERROR ${row.id} (${row.name}): ${error.message}`);
      continue;
    }
    cleaned++;
  }
  console.log(`\n✓ ${cleaned} leads limpiados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
