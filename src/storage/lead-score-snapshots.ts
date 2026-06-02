import { getSupabase } from "../shared/supabase.js";
import type { Lead } from "../shared/types.js";
import type { LeadScoreSnapshot } from "../modules/scoring/types.js";

export async function createLeadScoreSnapshots(snapshotLabel: string, leads: Lead[]): Promise<void> {
  if (leads.length === 0) return;
  const db = getSupabase();
  const pageSize = 500;

  for (let start = 0; start < leads.length; start += pageSize) {
    const chunk = leads.slice(start, start + pageSize).map((lead) => ({
      lead_id: lead.id,
      snapshot_label: snapshotLabel,
      scoring_version: lead.scoring_version ?? 0,
      prospect_score: lead.prospect_score,
      score_breakdown: lead.score_breakdown,
      contact_ready: lead.contact_ready,
    }));

    const { error } = await db.from("lead_score_snapshots").insert(chunk);
    if (error) throw new Error(`Failed to create score snapshots: ${error.message}`);
  }
}

export async function loadLeadScoreSnapshots(snapshotLabel: string): Promise<LeadScoreSnapshot[]> {
  const { data, error } = await getSupabase()
    .from("lead_score_snapshots")
    .select("*")
    .eq("snapshot_label", snapshotLabel)
    .order("lead_id");
  if (error) throw new Error(`Failed to load score snapshots ${snapshotLabel}: ${error.message}`);
  return (data ?? []) as LeadScoreSnapshot[];
}
