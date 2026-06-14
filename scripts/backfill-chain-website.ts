// Backfill B2 (parcial): propagar el dominio de empresa a fichas del mismo negocio
// sin web. Usa computeChainWebsitePropagations (regla segura: solo dominio real
// dominante, nunca redes sociales). SIN red — solo lee/escribe la columna website.
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/backfill-chain-website.ts [--apply]
//
// ⚠️ Mutación: backup antes de --apply. Tras aplicar, re-enriquecer los afectados
//    (ahora tienen web → fetch real) y re-scorear.

import { getSupabase } from "../src/shared/supabase.js";
import {
  computeChainWebsitePropagations,
  type PropagationLead,
} from "../src/modules/discovery/chain-website-propagation.js";

const PAGE_SIZE = 1000;
const APPLY = process.argv.includes("--apply");

async function loadAll(): Promise<PropagationLead[]> {
  const db = getSupabase();
  const rows: PropagationLead[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, website")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    const batch = (data ?? []) as PropagationLead[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main(): Promise<void> {
  const leads = await loadAll();
  const propagations = computeChainWebsitePropagations(leads);

  console.log(`Propagaciones detectadas: ${propagations.length}`);
  for (const p of propagations) {
    const lead = leads.find((l) => l.id === p.id);
    console.log(`  ${lead?.name} (${p.id.slice(0, 8)}) ← ${p.website}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — nada modificado. Correr con --apply para persistir.");
    return;
  }

  const db = getSupabase();
  let applied = 0;
  for (const p of propagations) {
    const { error } = await db.from("leads").update({ website: p.website }).eq("id", p.id);
    if (error) {
      console.error(`  ERROR ${p.id}: ${error.message}`);
      continue;
    }
    applied++;
  }
  console.log(`\n✓ ${applied} websites propagados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
