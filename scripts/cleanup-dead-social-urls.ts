// Reproceso: re-evalúa las URLs de redes (FB/IG) ya asignadas a cada lead y marca/limpia
// las que llevan a páginas muertas (borradas, redirigidas, título genérico).
// Idempotente: sobreescribe liveness (no acumula) y limpia tags vía Set (sin el bug splice).
//
// Uso:
//   node --env-file=.env --import tsx/esm scripts/cleanup-dead-social-urls.ts [--apply] [--limit N]
// Sin --apply: dry-run (no escribe nada).

import { getSupabase } from "../src/shared/supabase.js";
import { fetchHtml } from "../src/modules/enrichment/http.js";
import {
  detectLiveness,
  extractLivenessMeta,
  isHardDead,
  LIVENESS_DETECTOR_VERSION,
  type Liveness,
} from "../src/modules/social-enrich/liveness.js";

interface LeadRow {
  id: string;
  tags: string[] | null;
  digital_footprint: Record<string, unknown> | null;
}

const PAGE_SIZE = 500;
const PLATFORMS = ["facebook", "instagram"] as const;

async function loadCandidateLeads(): Promise<LeadRow[]> {
  const db = getSupabase();
  const rows: LeadRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("leads")
      .select("id, tags, digital_footprint")
      .or("tags.cs.{fb-confirmed},tags.cs.{ig-confirmed},tags.cs.{fb-heuristic},tags.cs.{ig-heuristic}")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadCandidateLeads failed: ${error.message}`);
    const batch = (data ?? []) as LeadRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function probeLiveness(platform: "facebook" | "instagram", url: string): Promise<Liveness> {
  const fetched = await fetchHtml(url);
  const meta = extractLivenessMeta(fetched.html);
  return detectLiveness({
    platform,
    requestedUrl: url,
    finalUrl: fetched.finalUrl,
    httpStatus: fetched.status,
    ogTitle: meta.ogTitle,
    ogDescription: meta.ogDescription,
    title: meta.title,
    h1: meta.h1,
    checkedAt: new Date().toISOString(),
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  console.log(`\n=== Cleanup redes muertas — ${apply ? "APPLY" : "DRY-RUN"} (detector v${LIVENESS_DETECTOR_VERSION}) ===\n`);

  const db = getSupabase();
  const leads = await loadCandidateLeads();
  let scanned = 0;
  let probed = 0;
  let hardDead = 0;
  let softDead = 0;
  const byReason: Record<string, number> = {};

  for (const lead of leads) {
    if (scanned >= limit) break;
    const fp = lead.digital_footprint;
    const selected = (fp?.["heuristic_discovery"] as { selected?: Record<string, { url?: string; liveness?: Liveness } | null> } | undefined)?.selected;
    if (!selected) continue;

    let changed = false;
    const nextFp = JSON.parse(JSON.stringify(fp)) as Record<string, unknown>;
    const nextSelected = (nextFp["heuristic_discovery"] as { selected: Record<string, { url?: string; liveness?: Liveness } | null> }).selected;
    const tags = new Set(lead.tags ?? []);

    for (const platform of PLATFORMS) {
      const cand = selected[platform];
      if (!cand?.url) continue;
      scanned++;
      probed++;
      const liveness = await probeLiveness(platform, cand.url);
      byReason[liveness.reason ?? liveness.state] = (byReason[liveness.reason ?? liveness.state] ?? 0) + 1;
      nextSelected[platform] = { ...cand, liveness };
      changed = true;

      if (isHardDead(liveness)) {
        hardDead++;
        const p = platform === "facebook" ? "fb" : "ig";
        tags.delete(`${p}-confirmed`);
        tags.delete(`${p}-heuristic`);
        tags.add(`${p}-dead`);
      } else if (liveness.state === "dead") {
        softDead++;
      }
    }

    if (changed && apply) {
      const { error } = await db
        .from("leads")
        .update({ digital_footprint: nextFp, tags: Array.from(tags) })
        .eq("id", lead.id);
      if (error) throw new Error(`update failed for ${lead.id}: ${error.message}`);
    }
  }

  console.log(`Leads con redes:   ${leads.length}`);
  console.log(`Redes re-probadas: ${probed}`);
  console.log(`Hard-dead (limpiadas): ${hardDead}`);
  console.log(`Soft-dead (atenuadas): ${softDead}`);
  console.log("Por resultado:");
  for (const [r, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  - ${r}: ${n}`);
  if (!apply) console.log("\n(dry-run — no se escribió nada. Re-ejecutar con --apply.)\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
