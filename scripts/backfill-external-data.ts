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

  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply para persistir.)");
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
