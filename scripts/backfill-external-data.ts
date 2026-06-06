// Backfill idempotente para fuentes externas:
//   1. GPS de OSM — re-deriva coordenadas desde source_data (el OSMElement crudo)
//      y las persiste en la columna `gps` (antes se descartaban al insertar).
//   2. Niche de MINTUR — re-infiere el niche desde source_data.TipoOperador
//      (muchos leads quedaron en 'other' por haber sido importados antes del parser).
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/backfill-external-data.ts [--apply]
//
// Sin --apply corre en dry-run (no escribe nada), solo reporta el diff.

import { getSupabase } from "../src/shared/supabase.js";
import { mapElement, type OSMElement } from "../src/modules/discovery/providers/osm.js";
import { inferNiche, type MINTURRecord } from "../src/modules/discovery/providers/mintur.js";
import { isValidCoord } from "../src/modules/discovery/geo-text.js";
import { leadHasContact, qualifyExternalLead } from "../src/modules/discovery/qualification.js";
import type { DiscoverySource, Lead } from "../src/shared/types.js";

const EXTERNAL_SOURCES: DiscoverySource[] = ["osm", "yelu", "mintur", "pedidosya"];

interface LeadRow {
  id: string;
  source: string;
  niche: string | null;
  gps: unknown;
  source_data: Record<string, unknown> | null;
}

const PAGE_SIZE = 1000;

async function loadLeadsBySource(source: string): Promise<LeadRow[]> {
  const db = getSupabase();
  const rows: LeadRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, source, niche, gps, source_data")
      .eq("source", source)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadLeadsBySource(${source}) failed: ${error.message}`);
    const batch = (data ?? []) as LeadRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function backfillOsmGps(apply: boolean): Promise<{ scanned: number; updated: number; skipped: number }> {
  const db = getSupabase();
  const leads = await loadLeadsBySource("osm");
  let updated = 0;
  let skipped = 0;

  for (const lead of leads) {
    if (lead.gps != null) {
      skipped++;
      continue;
    }
    if (!lead.source_data) {
      skipped++;
      continue;
    }
    const candidate = mapElement(lead.source_data as unknown as OSMElement);
    if (
      candidate.latitude == null ||
      candidate.longitude == null ||
      !isValidCoord(candidate.latitude, candidate.longitude)
    ) {
      skipped++;
      continue;
    }
    const gps = `SRID=4326;POINT(${candidate.longitude} ${candidate.latitude})`;
    if (apply) {
      const { error } = await db.from("leads").update({ gps }).eq("id", lead.id);
      if (error) throw new Error(`osm gps update failed for ${lead.id}: ${error.message}`);
    }
    updated++;
  }

  return { scanned: leads.length, updated, skipped };
}

async function backfillMinturNiche(apply: boolean): Promise<{ scanned: number; updated: number; unchanged: number; byNiche: Record<string, number> }> {
  const db = getSupabase();
  const leads = await loadLeadsBySource("mintur");
  let updated = 0;
  let unchanged = 0;
  const byNiche: Record<string, number> = {};

  for (const lead of leads) {
    if (!lead.source_data) {
      unchanged++;
      continue;
    }
    const niche = inferNiche(lead.source_data as unknown as MINTURRecord);
    if (niche === lead.niche) {
      unchanged++;
      continue;
    }
    byNiche[niche] = (byNiche[niche] ?? 0) + 1;
    if (apply) {
      const { error } = await db.from("leads").update({ niche }).eq("id", lead.id);
      if (error) throw new Error(`mintur niche update failed for ${lead.id}: ${error.message}`);
    }
    updated++;
  }

  return { scanned: leads.length, updated, unchanged, byNiche };
}

async function requalifyExternals(apply: boolean): Promise<{ scanned: number; changed: number; nowVisible: number; nowHidden: number; reasons: Record<string, number> }> {
  const db = getSupabase();
  let scanned = 0;
  let changed = 0;
  let nowVisible = 0;
  let nowHidden = 0;
  const reasons: Record<string, number> = {};

  for (const source of EXTERNAL_SOURCES) {
    let from = 0;
    for (;;) {
      const { data, error } = await db
        .from("leads")
        .select("id, source, passed_filter, phone, website, canonical_fields, digital_footprint, corroborating_sources")
        .eq("source", source)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`requalify load(${source}) failed: ${error.message}`);
      const batch = (data ?? []) as Lead[];
      for (const lead of batch) {
        scanned++;
        const corroborated = (lead.corroborating_sources?.length ?? 0) > 0;
        const result = qualifyExternalLead({
          source: lead.source,
          hasContact: leadHasContact(lead),
          corroborated,
        });
        if (result.passed_filter === lead.passed_filter) continue;
        changed++;
        if (result.passed_filter) nowVisible++;
        else {
          nowHidden++;
          for (const r of result.rejection_reasons) reasons[r] = (reasons[r] ?? 0) + 1;
        }
        if (apply) {
          const { error: upErr } = await db
            .from("leads")
            .update({ passed_filter: result.passed_filter, rejection_reasons: result.rejection_reasons })
            .eq("id", lead.id);
          if (upErr) throw new Error(`requalify update failed for ${lead.id}: ${upErr.message}`);
        }
      }
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return { scanned, changed, nowVisible, nowHidden, reasons };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== Backfill external data — ${mode} ===\n`);

  const osm = await backfillOsmGps(apply);
  console.log("OSM GPS backfill:");
  console.log(`  scanned:  ${osm.scanned}`);
  console.log(`  updated:  ${osm.updated}${apply ? "" : " (pendientes)"}`);
  console.log(`  skipped:  ${osm.skipped}`);

  const mintur = await backfillMinturNiche(apply);
  console.log("\nMINTUR niche backfill:");
  console.log(`  scanned:    ${mintur.scanned}`);
  console.log(`  updated:    ${mintur.updated}${apply ? "" : " (pendientes)"}`);
  console.log(`  unchanged:  ${mintur.unchanged}`);
  console.log("  nuevos niches:");
  for (const [niche, count] of Object.entries(mintur.byNiche).sort((a, b) => b[1] - a[1])) {
    console.log(`    - ${niche}: ${count}`);
  }

  const requal = await requalifyExternals(apply);
  console.log("\nRe-calificación de externos (passed_filter):");
  console.log(`  scanned:       ${requal.scanned}`);
  console.log(`  cambian:       ${requal.changed}${apply ? "" : " (pendientes)"}`);
  console.log(`  → visibles:    ${requal.nowVisible}`);
  console.log(`  → ocultos:     ${requal.nowHidden}`);
  if (Object.keys(requal.reasons).length > 0) {
    console.log("  razones de descarte:");
    for (const [r, c] of Object.entries(requal.reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${r}: ${c}`);
    }
  }

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply para persistir.)");
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
