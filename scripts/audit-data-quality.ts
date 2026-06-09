// Auditoría read-only de calidad de datos para revisión comercial.
// Uso: pnpm tsx scripts/audit-data-quality.ts
import { getSupabase } from "../src/shared/supabase.js";

interface CanonicalField {
  value?: string;
  confidence?: number;
  sources?: string[];
  conflict?: boolean;
  stale?: boolean;
  conflict_alternatives?: unknown[];
}

async function main(): Promise<void> {
  const db = getSupabase();

  const { count: total } = await db.from("leads").select("*", { count: "exact", head: true });

  // Tiers desde la vista de dashboard (contact_tier es columna derivada).
  const { data: tierRows } = await db.from("lead_dashboard").select("id, contact_tier").limit(10000);
  const tierById = new Map<string, string>();
  for (const t of tierRows ?? []) tierById.set(t.id as string, (t.contact_tier as string) ?? "none");

  const { data: rows, error } = await db
    .from("leads")
    .select("id, prospect_score, phone, website, whatsapp, address, source, canonical_fields, corroborating_sources, digital_footprint, data_confidence_score, contact_reliability_score")
    .limit(10000);
  if (error) throw new Error(error.message);

  const agg = {
    total_leads: total ?? 0,
    sampled: rows?.length ?? 0,
    coverage: { phone: 0, website: 0, whatsapp: 0, email: 0, address: 0 },
    tiers: {} as Record<string, number>,
    sources: {} as Record<string, number>,
    canonical: { with_fields: 0, with_conflict: 0, multi_source: 0, stale: 0, with_alternatives: 0 },
    corroboration: { multi_source_leads: 0, avg_sources: 0 },
    social: { with_search: 0, with_activity: 0, real_fb: 0, real_ig: 0, abandoned: 0 },
    hot_leads: 0,
    confidence: { avg_data: 0, avg_contact_reliability: 0 },
  };

  let sourcesSum = 0;
  let dataConfSum = 0;
  let dataConfN = 0;
  let relSum = 0;
  let relN = 0;

  for (const r of rows ?? []) {
    if (r.phone) agg.coverage.phone++;
    if (r.website) agg.coverage.website++;
    if (r.whatsapp) agg.coverage.whatsapp++;
    if (r.address) agg.coverage.address++;
    const cfEmail = (r.canonical_fields as Record<string, { value?: string }> | null)?.["email"]?.value;
    const fpEmails = (r.digital_footprint as { contact_emails?: unknown[] } | null)?.contact_emails;
    if (cfEmail || (Array.isArray(fpEmails) && fpEmails.length > 0)) agg.coverage.email++;

    const tier = tierById.get(r.id as string) ?? "none";
    agg.tiers[tier] = (agg.tiers[tier] ?? 0) + 1;
    const src = r.source ?? "unknown";
    agg.sources[src] = (agg.sources[src] ?? 0) + 1;

    // Umbral consistente con HOT_LEAD_THRESHOLD del backend (admin/costs.ts = 55).
    if (typeof r.prospect_score === "number" && r.prospect_score >= 55) agg.hot_leads++;

    if (typeof r.data_confidence_score === "number") { dataConfSum += r.data_confidence_score; dataConfN++; }
    if (typeof r.contact_reliability_score === "number") { relSum += r.contact_reliability_score; relN++; }

    const cf = r.canonical_fields as Record<string, CanonicalField> | null;
    if (cf && typeof cf === "object" && Object.keys(cf).length > 0) {
      agg.canonical.with_fields++;
      for (const field of Object.values(cf)) {
        if (field?.conflict) agg.canonical.with_conflict++;
        if (Array.isArray(field?.sources) && field.sources.length > 1) agg.canonical.multi_source++;
        if (field?.stale) agg.canonical.stale++;
        if (Array.isArray(field?.conflict_alternatives) && field.conflict_alternatives.length > 0) agg.canonical.with_alternatives++;
      }
    }

    const corr = r.corroborating_sources as unknown[] | null;
    if (Array.isArray(corr) && corr.length > 0) { agg.corroboration.multi_source_leads++; sourcesSum += corr.length; }

    const fp = r.digital_footprint as Record<string, unknown> | null;
    const ss = fp?.["social_search"] as { facebook?: { url?: string } | null; instagram?: { url?: string } | null } | undefined;
    if (ss) {
      agg.social.with_search++;
      if (ss.facebook?.url) agg.social.real_fb++;
      if (ss.instagram?.url) agg.social.real_ig++;
    }
    const sa = fp?.["social_activity"] as { summary?: { activity_status?: string }; profiles?: Record<string, { activity_status?: string }> } | undefined;
    if (sa) {
      agg.social.with_activity++;
      const statuses = Object.values(sa.profiles ?? {}).map((p) => p.activity_status);
      if (statuses.includes("abandoned")) agg.social.abandoned++;
    }
  }

  agg.corroboration.avg_sources = agg.corroboration.multi_source_leads > 0 ? Math.round((sourcesSum / agg.corroboration.multi_source_leads) * 100) / 100 : 0;
  agg.confidence.avg_data = dataConfN > 0 ? Math.round((dataConfSum / dataConfN) * 1000) / 1000 : 0;
  agg.confidence.avg_contact_reliability = relN > 0 ? Math.round((relSum / relN) * 1000) / 1000 : 0;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(agg, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
