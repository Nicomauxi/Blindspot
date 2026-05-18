import { getSupabase } from "../shared/supabase.js";

export interface OutreachStats {
  total: number;
  by_status: Record<string, number>;
  by_channel: Record<string, number>;
  by_outcome: Record<string, number>;
  conversion_rate: number;
  response_rate: number;
}

export async function getOutreachStats(): Promise<OutreachStats> {
  const db = getSupabase();

  const { data, error } = await db
    .from("lead_outreach")
    .select("status, channel, outcome, responded");

  if (error) throw new Error(`Failed to load outreach stats: ${error.message}`);

  const rows = (data ?? []) as {
    status: string;
    channel: string;
    outcome: string | null;
    responded: boolean | null;
  }[];

  const total = rows.length;

  const by_status: Record<string, number> = {};
  const by_channel: Record<string, number> = {};
  const by_outcome: Record<string, number> = {};
  let closed_won = 0;
  let responded = 0;

  for (const row of rows) {
    by_status[row.status] = (by_status[row.status] ?? 0) + 1;
    by_channel[row.channel] = (by_channel[row.channel] ?? 0) + 1;
    if (row.outcome) {
      by_outcome[row.outcome] = (by_outcome[row.outcome] ?? 0) + 1;
    }
    if (row.outcome === "closed_won") closed_won++;
    if (row.responded) responded++;
  }

  return {
    total,
    by_status,
    by_channel,
    by_outcome,
    conversion_rate: total > 0 ? closed_won / total : 0,
    response_rate: total > 0 ? responded / total : 0,
  };
}
