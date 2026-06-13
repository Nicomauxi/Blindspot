// Fase 3: re-enriquecer los leads que ganaron un website real (vía enrich-unified) pero
// siguen con footprint/tags de "sin web". Hace el fetch real del sitio (pixels/ssl/stack/
// inferred_state) y limpia el tag stale 'no-website'/'high-reviews-no-web' → la oferta deja
// de decir web_nuevo cuando ya tienen sitio. Concurrencia acotada (fetch a sitios reales).
//
// Uso: node --env-file=.env --import tsx/esm scripts/backfill-reenrich-websites.ts [--apply]

import pLimit from "p-limit";
import { getSupabase } from "../src/shared/supabase.js";
import { enrichLead } from "../src/modules/enrichment/index.js";
import { updateLeadEnrichment } from "../src/storage/leads.js";
import type { Lead } from "../src/shared/types.js";

const APPLY = process.argv.includes("--apply");
const STALE_TAGS = ["no-website", "high-reviews-no-web"];
const SOCIAL_RE = /(facebook|instagram|linktr|beacons|wa\.me|whatsapp|tiktok|twitter|x\.com)/i;

async function loadTargets(): Promise<Lead[]> {
  // real website + algún tag stale de "sin web".
  const { data, error } = await getSupabase()
    .from("leads")
    .select("*")
    .eq("passed_filter", true)
    .not("website", "is", null)
    .overlaps("tags", STALE_TAGS);
  if (error) throw new Error(`load failed: ${error.message}`);
  return (data as Lead[]).filter((l) => !!l.website && !SOCIAL_RE.test(l.website));
}

async function main(): Promise<void> {
  const targets = await loadTargets();
  console.log(`Leads con website real + tag stale de sin-web: ${targets.length}`);
  if (!APPLY) {
    for (const l of targets.slice(0, 10)) console.log(`  ${l.name} → ${l.website}`);
    console.log("\nDRY-RUN — nada modificado. Correr con --apply.");
    return;
  }

  const limit = pLimit(5);
  let ok = 0, failed = 0;
  await Promise.all(targets.map((lead) => limit(async () => {
    try {
      const result = await enrichLead(lead, { forceRefresh: true, withHeuristic: false });
      // Quitar los tags stale de sin-web (el lead YA tiene sitio); el resto lo maneja el merge.
      const tags = result.tags_to_add.filter((t) => !STALE_TAGS.includes(t));
      await updateLeadEnrichment(lead.id, result.digital_footprint, tags, result.whatsapp_from_site, result.inferred_state);
      // Limpiar los stale que pudieran sobrevivir el merge (vienen del lead, no de tags_to_add).
      const { data: fresh } = await getSupabase().from("leads").select("tags").eq("id", lead.id).single();
      const current: string[] = Array.isArray(fresh?.tags) ? fresh.tags : [];
      const cleaned = current.filter((t) => !STALE_TAGS.includes(t));
      if (cleaned.length !== current.length) {
        await getSupabase().from("leads").update({ tags: cleaned }).eq("id", lead.id);
      }
      ok++;
    } catch (err) {
      failed++;
      console.error(`  ERROR ${lead.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  })));
  console.log(`\n✓ re-enriquecidos ${ok} / fallidos ${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
