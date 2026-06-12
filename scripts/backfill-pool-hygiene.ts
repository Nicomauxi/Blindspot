// F5 — Higiene de pool. Backfills idempotentes, dry-run por defecto.
//   F5.1: leads con tag 'duplicate-secondary' y passed_filter=true → fuera del pool
//         (passed_filter=false + rejection_reason 'duplicate-secondary').
//   F5.2: leads en pool SIN canal de contacto accionable (leadHasContact, incluye tags
//         para excluir redes muertas — N19) → fuera del pool con razón 'no-contact'.
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/backfill-pool-hygiene.ts [--apply]
//
// ⚠️ Mutación masiva: correr `bash scripts/backup.sh` antes de --apply.

import { getSupabase } from "../src/shared/supabase.js";
import { leadHasContact } from "../src/modules/discovery/qualification.js";
import { findGenericSharedPhones, isJunkPhone } from "../src/modules/discovery/phone-quality.js";
import type { Lead } from "../src/shared/types.js";

/** F5.3: phone compartido por más de N leads = genérico (gestor/institución). */
const SHARED_PHONE_THRESHOLD = 5;
const SHARED_PHONE_TAG = "shared-phone-generic";

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

interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  canonical_fields: Lead["canonical_fields"];
  digital_footprint: Lead["digital_footprint"];
  tags: string[];
  rejection_reasons: string[] | null;
}

async function loadPooledWithoutContact(): Promise<ContactRow[]> {
  const db = getSupabase();
  const rows: ContactRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, phone, website, canonical_fields, digital_footprint, tags, rejection_reasons")
      .eq("passed_filter", true)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load pool failed: ${error.message}`);
    rows.push(...((data ?? []) as ContactRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows.filter((r) => !leadHasContact(r as unknown as Lead));
}

async function applyExclusions(
  rows: Array<{ id: string; rejection_reasons: string[] | null }>,
  reason: string
): Promise<void> {
  const db = getSupabase();
  let updated = 0;
  const failures: string[] = [];
  for (const r of rows) {
    const reasons = Array.from(new Set([...(r.rejection_reasons ?? []), reason]));
    const { error } = await db
      .from("leads")
      .update({ passed_filter: false, rejection_reasons: reasons })
      .eq("id", r.id);
    if (error) failures.push(`${r.id}: ${error.message}`);
    else updated++;
  }
  console.log(`  actualizados (${reason}): ${updated}`);
  if (failures.length > 0) {
    console.error(`  fallos (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.error(`    ! ${f}`);
    process.exit(1);
  }
}

interface PhoneRow {
  id: string;
  name: string;
  phone: string | null;
  tags: string[];
}

async function loadAllPhones(): Promise<PhoneRow[]> {
  const db = getSupabase();
  const rows: PhoneRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, name, phone, tags")
      .not("phone", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`load phones failed: ${error.message}`);
    rows.push(...((data ?? []) as PhoneRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== F5 backfill pool-hygiene — ${apply ? "APPLY" : "DRY-RUN"} ===\n`);

  const dupes = await loadPooledDuplicateSecondaries();
  console.log(`F5.1 duplicate-secondary en pool: ${dupes.length}`);
  for (const r of dupes.slice(0, 10)) console.log(`  - ${r.id} ${r.name}`);

  const noContact = await loadPooledWithoutContact();
  console.log(`F5.2 sin contacto accionable en pool: ${noContact.length}`);
  for (const r of noContact.slice(0, 10)) console.log(`  - ${r.id} ${r.name}`);

  // F5.4: emails guardados en website → digital_footprint.contact_emails; names placeholder
  // → fuera del pool.
  const db0 = getSupabase();
  const { data: emailWebs, error: ewErr } = await db0
    .from("leads")
    .select("id, name, website, digital_footprint")
    .like("website", "%@%")
    .not("website", "like", "http%");
  if (ewErr) throw new Error(`load email-websites failed: ${ewErr.message}`);
  const emailRe = /^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/;
  const emailRows = (emailWebs ?? []).filter((r) => emailRe.test((r.website ?? "").trim()));
  console.log(`F5.4 emails en website: ${emailRows.length}`);
  for (const r of emailRows) console.log(`  - ${r.id} ${r.name} website='${r.website}'`);

  const { data: badNames, error: bnErr } = await db0
    .from("leads")
    .select("id, name, rejection_reasons")
    .in("name", ["N/A", "n/a", "NA", "-", "."]);
  if (bnErr) throw new Error(`load placeholder names failed: ${bnErr.message}`);
  console.log(`F5.4 names placeholder: ${(badNames ?? []).length}`);
  for (const r of badNames ?? []) console.log(`  - ${r.id} name='${r.name}'`);

  const phoneRows = await loadAllPhones();
  const junk = phoneRows.filter((r) => isJunkPhone(r.phone));
  const generic = findGenericSharedPhones(phoneRows.map((r) => r.phone), SHARED_PHONE_THRESHOLD);
  const genericRows = phoneRows.filter((r) => {
    if (isJunkPhone(r.phone)) return false; // su phone se anula en el paso junk
    const digits = (r.phone ?? "").replace(/\D/g, "");
    return generic.has(digits) && !r.tags.includes(SHARED_PHONE_TAG);
  });
  console.log(`F5.3 phones placeholder (→ phone=null): ${junk.length}`);
  for (const r of junk.slice(0, 10)) console.log(`  - ${r.id} ${r.name} phone='${r.phone}'`);
  console.log(`F5.3 phones genéricos compartidos >${SHARED_PHONE_THRESHOLD} (→ tag): ${genericRows.length} leads / ${generic.size} números`);
  for (const d of [...generic].slice(0, 10)) console.log(`  - ${d}`);

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply.)\n");
    return;
  }

  await applyExclusions(dupes, "duplicate-secondary");
  await applyExclusions(noContact, "no-contact");

  const db = getSupabase();
  let junkCleared = 0;
  for (const r of junk) {
    const { error } = await db.from("leads").update({ phone: null }).eq("id", r.id);
    if (error) console.error(`  ! junk ${r.id}: ${error.message}`);
    else junkCleared++;
  }
  console.log(`  phones placeholder anulados: ${junkCleared}`);

  let tagged = 0;
  for (const r of genericRows) {
    const { error } = await db
      .from("leads")
      .update({ tags: [...r.tags, SHARED_PHONE_TAG] })
      .eq("id", r.id);
    if (error) console.error(`  ! generic ${r.id}: ${error.message}`);
    else tagged++;
  }
  console.log(`  tagueados ${SHARED_PHONE_TAG}: ${tagged}`);

  let moved = 0;
  for (const r of emailRows) {
    const fp = (r.digital_footprint ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(fp.contact_emails) ? (fp.contact_emails as string[]) : [];
    const emails = Array.from(new Set([...existing, (r.website as string).trim()]));
    const { error } = await db
      .from("leads")
      .update({ website: null, digital_footprint: { ...fp, contact_emails: emails } })
      .eq("id", r.id);
    if (error) console.error(`  ! email-web ${r.id}: ${error.message}`);
    else moved++;
  }
  console.log(`  emails movidos de website: ${moved}`);

  await applyExclusions(badNames ?? [], "placeholder-name");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
