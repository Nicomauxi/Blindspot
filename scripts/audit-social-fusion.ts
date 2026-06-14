// Auditoría read-only del impacto de la fusión social en canonical_fields.
// Responde: qué leads ganaron phone/website/email por la red social, cuántos
// quedaron corroborados multi-fuente, conflictos Google-vs-social y flags stale.
// Uso: node --env-file=.env --import tsx/esm scripts/audit-social-fusion.ts
import { getSupabase } from "../src/shared/supabase.js";

const SOCIAL_SOURCES = new Set(["social_instagram", "social_facebook"]);
const PAGE_SIZE = 1000;
const FIELD_KEYS = ["phone", "website", "email", "address", "gps"] as const;

interface CanonicalField {
  value?: unknown;
  confidence?: number;
  sources?: string[];
  conflict?: boolean;
  stale?: boolean;
  conflict_alternatives?: Array<{ source?: string }>;
}

interface LeadRow {
  id: string;
  canonical_fields: Record<string, CanonicalField> | null;
  digital_footprint: { social_activity?: { summary?: { activity_status?: string } } } | null;
}

function hasSocialSource(sources: string[] | undefined): boolean {
  return (sources ?? []).some((s) => SOCIAL_SOURCES.has(s));
}

function socialInAlternatives(field: CanonicalField): boolean {
  return (field.conflict_alternatives ?? []).some((a) => a.source !== undefined && SOCIAL_SOURCES.has(a.source));
}

async function loadAllLeadRows(): Promise<LeadRow[]> {
  const db = getSupabase();
  const rows: LeadRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("leads")
      .select("id, canonical_fields, digital_footprint")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as LeadRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main(): Promise<void> {
  const rows = await loadAllLeadRows();

  const perField: Record<string, { social_only: number; social_corroborated: number; conflict_with_social: number; stale: number }> = {};
  for (const key of FIELD_KEYS) {
    perField[key] = { social_only: 0, social_corroborated: 0, conflict_with_social: 0, stale: 0 };
  }

  let leadsWithCanonical = 0;
  let leadsWithSocialInCanonical = 0;
  let leadsGainedFieldFromSocial = 0;
  let leadsWithSocialConflict = 0;
  let leadsWithStale = 0;
  const activityStatus: Record<string, number> = {};
  const sampleGained: Array<{ id: string; field: string; sources: string[] }> = [];
  const sampleConflicts: Array<{ id: string; field: string; sources: string[] }> = [];

  for (const row of rows) {
    const cf = row.canonical_fields;
    const status = row.digital_footprint?.social_activity?.summary?.activity_status;
    if (status) activityStatus[status] = (activityStatus[status] ?? 0) + 1;
    if (!cf || Object.keys(cf).length === 0) continue;
    leadsWithCanonical += 1;

    let socialInLead = false;
    let gainedInLead = false;
    let conflictInLead = false;
    let staleInLead = false;

    for (const key of FIELD_KEYS) {
      const field = cf[key];
      if (!field) continue;
      const bucket = perField[key]!;
      const social = hasSocialSource(field.sources);
      const socialAlt = socialInAlternatives(field);
      if (!social && !socialAlt) continue;
      socialInLead = true;

      const sources = field.sources ?? [];
      if (social && sources.length === 1) {
        bucket.social_only += 1;
        gainedInLead = true;
        if (sampleGained.length < 10) sampleGained.push({ id: row.id, field: key, sources });
      } else if (social) {
        bucket.social_corroborated += 1;
      }
      if (field.conflict === true) {
        bucket.conflict_with_social += 1;
        conflictInLead = true;
        if (sampleConflicts.length < 10) sampleConflicts.push({ id: row.id, field: key, sources });
      }
      if (field.stale === true) {
        bucket.stale += 1;
        staleInLead = true;
      }
    }

    if (socialInLead) leadsWithSocialInCanonical += 1;
    if (gainedInLead) leadsGainedFieldFromSocial += 1;
    if (conflictInLead) leadsWithSocialConflict += 1;
    if (staleInLead) leadsWithStale += 1;
  }

  console.log(
    JSON.stringify(
      {
        total_leads: rows.length,
        leads_with_canonical_fields: leadsWithCanonical,
        leads_with_social_in_canonical: leadsWithSocialInCanonical,
        leads_gained_field_from_social: leadsGainedFieldFromSocial,
        leads_with_google_vs_social_conflict: leadsWithSocialConflict,
        leads_with_stale_social_data: leadsWithStale,
        per_field: perField,
        social_activity_status: activityStatus,
        sample_gained: sampleGained,
        sample_conflicts: sampleConflicts,
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
