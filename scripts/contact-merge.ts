// Unión cross-source por contacto compartido (teléfono/email/dominio propio).
// - Auto-merge de alta confianza (mismo contacto + ciudad compatible, no cadena).
// - Zona gris (ciudad distinta, nombre dispar, cadena) → cola lead_merge_candidates.
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/contact-merge.ts [--apply]
// Sin --apply: dry-run (no escribe nada).

import { getSupabase } from "../src/shared/supabase.js";
import { loadAllLeads } from "../src/storage/leads.js";
import { reconcileLeadIntoPrimary } from "../src/storage/reconciliation.js";
import { buildContactMergePlan } from "../src/modules/discovery/contact-reconciliation.js";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== Contact merge — ${mode} ===\n`);

  const leads = await loadAllLeads();
  const plan = buildContactMergePlan(leads);

  console.log(`Leads analizados:      ${leads.length}`);
  console.log(`Auto-merge (alta conf):${plan.auto.length}`);
  console.log(`A revisión (zona gris):${plan.review.length}`);
  console.log(`Cadenas detectadas:    ${plan.chains.length}`);

  const byReason: Record<string, number> = {};
  for (const c of plan.review) byReason[c.reason] = (byReason[c.reason] ?? 0) + 1;
  if (plan.review.length > 0) {
    console.log("  revisión por razón:");
    for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${r}: ${n}`);
    }
  }
  if (plan.chains.length > 0) {
    console.log("  cadenas (top):");
    for (const c of plan.chains.slice(0, 10)) {
      console.log(`    - ${c.kind} ${c.key}: ${c.lead_count} leads`);
    }
  }

  // Muestra de auto-merges
  console.log("  auto-merge (muestra):");
  for (const c of plan.auto.slice(0, 15)) {
    console.log(`    - [${c.primary_source}<-${c.secondary_source}] ${c.reason} ${c.kind}=${c.key} (sim ${c.name_similarity})`);
  }

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply.)\n");
    return;
  }

  const db = getSupabase();

  // 1) Auto-merges. Un lead puede aparecer en varios pares (transitivo): saltar los que
  //    ya fueron absorbidos/borrados en esta corrida.
  const gone = new Set<string>();
  let merged = 0;
  let skipped = 0;
  for (const c of plan.auto) {
    if (gone.has(c.primary_id) || gone.has(c.secondary_id) || c.primary_id === c.secondary_id) {
      skipped++;
      continue;
    }
    try {
      await reconcileLeadIntoPrimary(c.primary_id, c.secondary_id);
      gone.add(c.secondary_id);
      merged++;
    } catch (err) {
      skipped++;
      console.error(`    ! merge ${c.primary_id}<-${c.secondary_id} falló: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) Zona gris → cola lead_merge_candidates (idempotente por par). Excluir pares cuyos
  //    leads ya no existen por un auto-merge previo.
  const reviewRows = plan.review
    .filter((c) => !gone.has(c.primary_id) && !gone.has(c.secondary_id))
    .map((c) => ({
      primary_lead_id: c.primary_id,
      secondary_lead_id: c.secondary_id,
      match_kind: c.kind,
      match_key: c.key,
      same_city: c.same_city,
      name_similarity: c.name_similarity,
      reason: c.reason,
      status: "pending",
    }));

  let queued = 0;
  if (reviewRows.length > 0) {
    const { error } = await db
      .from("lead_merge_candidates")
      .upsert(reviewRows, { onConflict: "primary_lead_id,secondary_lead_id", ignoreDuplicates: true });
    if (error) throw new Error(`upsert lead_merge_candidates failed: ${error.message}`);
    queued = reviewRows.length;
  }

  console.log(`\nAplicado:`);
  console.log(`  merges:           ${merged}`);
  console.log(`  saltados:         ${skipped}`);
  console.log(`  encolados revisión:${queued}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
