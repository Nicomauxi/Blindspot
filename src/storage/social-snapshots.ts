import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";
import type { SocialActivityProfile } from "../modules/social-enrich/social-activity.js";
import type { SocialSnapshotPoint } from "../modules/social-enrich/social-history.js";

export interface SocialSnapshotRow extends SocialSnapshotPoint {
  platform: string;
  following: number | null;
  audience_tier: string | null;
}

// Carga el histórico de snapshots de un lead, ordenado por fecha asc, agrupado por plataforma.
export async function loadSocialSnapshots(leadId: string): Promise<Record<string, SocialSnapshotRow[]>> {
  const db = getSupabase();
  const { data, error } = await db
    .from("social_activity_snapshots")
    .select("platform, captured_at, followers, following, posts, likes, talking_about, audience_tier, activity_status")
    .eq("lead_id", leadId)
    .order("captured_at", { ascending: true });
  if (error) throw new Error(`loadSocialSnapshots failed for ${leadId}: ${error.message}`);

  const byPlatform: Record<string, SocialSnapshotRow[]> = {};
  for (const row of (data ?? []) as SocialSnapshotRow[]) {
    (byPlatform[row.platform] ??= []).push(row);
  }
  return byPlatform;
}

async function lastSnapshot(leadId: string, platform: string): Promise<SocialSnapshotRow | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("social_activity_snapshots")
    .select("platform, captured_at, followers, following, posts, likes, talking_about, audience_tier, activity_status")
    .eq("lead_id", leadId)
    .eq("platform", platform)
    .order("captured_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`lastSnapshot failed: ${error.message}`);
  const rows = (data ?? []) as SocialSnapshotRow[];
  return rows[0] ?? null;
}

// Registra snapshots históricos (append-only) solo cuando cambia el estado/audiencia/conteos
// relevantes respecto al último, para que la tabla sea un log de eventos y no crezca con
// scrapes idénticos. Best-effort: el estado actual (digital_footprint) es la fuente operativa.
export async function recordSocialSnapshots(
  leadId: string,
  profiles: SocialActivityProfile[],
  capturedAt: string
): Promise<number> {
  const db = getSupabase();
  let inserted = 0;
  for (const p of profiles) {
    try {
      const prev = await lastSnapshot(leadId, p.platform);
      const changed =
        prev == null ||
        prev.activity_status !== p.activity_status ||
        prev.audience_tier !== p.audience_tier ||
        prev.followers !== p.followers ||
        prev.likes !== p.likes ||
        prev.posts !== p.posts;
      if (!changed) continue;

      const { error } = await db
        .from("social_activity_snapshots")
        .upsert(
          {
            lead_id: leadId,
            platform: p.platform,
            captured_at: capturedAt,
            followers: p.followers,
            following: p.following,
            posts: p.posts,
            likes: p.likes,
            talking_about: p.talking_about,
            audience_tier: p.audience_tier,
            activity_status: p.activity_status,
            source: "playwright_public",
          },
          { onConflict: "lead_id,platform,captured_at", ignoreDuplicates: true }
        );
      if (error) throw new Error(error.message);
      inserted += 1;
    } catch (err) {
      // Best-effort: el histórico no debe romper el enrich.
      getLogger().warn({ leadId, platform: p.platform, err: err instanceof Error ? err.message : String(err) }, "social snapshot insert failed");
    }
  }
  return inserted;
}
