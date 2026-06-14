// Auditoría del plan de reconciliación retroactiva: imprime cada merge propuesto con
// evidencia (nombres, direcciones, teléfonos) para validar ANTES de aplicar (--apply).
import { getDedupGeoRadiusMeters, getRetroactiveDedupThreshold } from "../src/modules/discovery/config.js";
import { buildRetroactiveReconciliationPlan } from "../src/modules/discovery/reconciliation.js";
import { loadAllLeads } from "../src/storage/leads.js";

function phoneOf(lead: { phone: string | null; canonical_fields: unknown }): string | null {
  const cf = lead.canonical_fields as Record<string, unknown> | null;
  const raw = cf?.["phone"];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof (raw as { value: unknown }).value === "string") {
    return (raw as { value: string }).value;
  }
  return lead.phone;
}

async function main(): Promise<void> {
  const leads = await loadAllLeads();
  const plan = buildRetroactiveReconciliationPlan(leads, {
    threshold: getRetroactiveDedupThreshold(),
    geoRadiusMeters: getDedupGeoRadiusMeters(),
  });

  console.log(`Plan: ${plan.matched_secondaries} merges (umbral ${plan.threshold})\n`);
  for (const m of plan.matches) {
    const flag = m.phone_conflict ? " ⚠ TEL-CONFLICT" : "";
    console.log(`■ ${m.primary.name}  (sim ${m.similarity}, ${m.source_pair})${flag}`);
    console.log(`    dir P: ${m.primary.address ?? "∅"}`);
    console.log(`    dir S: ${m.secondary.address ?? "∅"}`);
    console.log(`    tel P: ${phoneOf(m.primary) ?? "∅"}   tel S: ${phoneOf(m.secondary) ?? "∅"}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
