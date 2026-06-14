// N0.3 (N47) — Limpieza de websites heurísticos asignados SIN señal de identidad
// (signals solo http-ok / http-ok+city-match): el sitio era de OTRO negocio y el
// enrichment cosechó emails/teléfonos/whatsapp ajenos.
//
// Por cada lead afectado:
//   - digital_footprint.heuristic_discovery → null (fuerza re-discovery con el scoring
//     corregido de c442232 en el próximo `enrich --with-heuristic`).
//   - Limpia lo cosechado del sitio ajeno: contact_emails, email_quality,
//     phone_alternatives, attempted_url, final_url, fetch_error, fetched_at.
//   - whatsapp derivado (tag whatsapp-derived) → null.
//   - Tags de heurística (website-heuristic, fb/ig-heuristic, email-found) → fuera.
//
// Uso: node --env-file=.env --import tsx/esm scripts/cleanup-foreign-websites.ts [--apply]
// ⚠️ Backup antes de --apply.

import { getSupabase } from "../src/shared/supabase.js";

const PAGE_SIZE = 1000;
const IDENTITY_SIGNALS = new Set(["name-match", "name_in_schema", "phone_in_schema"]);
const HARVESTED_KEYS = [
  "contact_emails", "email_quality", "phone_alternatives",
  "attempted_url", "final_url", "fetch_error", "fetched_at",
];
const HEURISTIC_TAGS = new Set(["website-heuristic", "fb-heuristic", "ig-heuristic", "email-found"]);

interface Row {
  id: string;
  name: string;
  whatsapp: string | null;
  tags: string[];
  digital_footprint: Record<string, unknown> | null;
}

function selectedWebsiteSignals(fp: Record<string, unknown> | null): string[] | null {
  const hd = fp?.["heuristic_discovery"] as Record<string, unknown> | undefined;
  const selected = hd?.["selected"] as Record<string, unknown> | undefined;
  const website = selected?.["website"] as Record<string, unknown> | null | undefined;
  if (!website) return null;
  const signals = website["signals"];
  return Array.isArray(signals) ? (signals as string[]) : [];
}

async function loadAffected(): Promise<Row[]> {
  const db = getSupabase();
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, whatsapp, tags, digital_footprint")
      .not("digital_footprint", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows.filter((r) => {
    const signals = selectedWebsiteSignals(r.digital_footprint);
    if (signals === null) return false;
    return !signals.some((s) => IDENTITY_SIGNALS.has(s));
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== N0.3 cleanup foreign websites — ${apply ? "APPLY" : "DRY-RUN"} ===\n`);

  const affected = await loadAffected();
  console.log(`Leads con website sin señal de identidad: ${affected.length}`);
  for (const r of affected.slice(0, 10)) {
    const hd = r.digital_footprint?.["heuristic_discovery"] as Record<string, unknown> | undefined;
    const url = ((hd?.["selected"] as Record<string, unknown>)?.["website"] as Record<string, unknown>)?.["url"];
    console.log(`  - ${r.id} ${r.name} → ${String(url)}`);
  }

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply.)\n");
    return;
  }

  const db = getSupabase();
  let updated = 0;
  const failures: string[] = [];
  for (const r of affected) {
    const fp: Record<string, unknown> = { ...(r.digital_footprint ?? {}) };
    fp["heuristic_discovery"] = null;
    for (const key of HARVESTED_KEYS) delete fp[key];

    const hadDerivedWhatsapp = r.tags.includes("whatsapp-derived");
    const tags = r.tags.filter((t) => !HEURISTIC_TAGS.has(t) && t !== "whatsapp-derived");

    const payload: Record<string, unknown> = { digital_footprint: fp, tags };
    if (hadDerivedWhatsapp) payload["whatsapp"] = null;

    const { error } = await db.from("leads").update(payload).eq("id", r.id);
    if (error) failures.push(`${r.id}: ${error.message}`);
    else updated++;
  }

  console.log(`\nLimpiados: ${updated}`);
  if (failures.length > 0) {
    console.error(`Fallos (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.error(`  ! ${f}`);
    process.exit(1);
  }
  console.log("Siguiente paso: node --env-file=.env --import tsx/esm src/cli/index.ts enrich --all --with-heuristic\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
