import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

export async function costsRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/costs/overview — current budget status + LLM usage totals
  app.get("/admin/costs/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();

    const [configRes, llmRes] = await Promise.all([
      db
        .from("pipeline_config")
        .select("google_places_budget_total, google_places_budget_spent, google_places_alert_threshold")
        .limit(1)
        .single(),
      db
        .from("llm_usage_log")
        .select("cost_usd, created_at")
        .order("created_at", { ascending: false }),
    ]);

    const config = configRes.data as {
      google_places_budget_total: number;
      google_places_budget_spent: number;
      google_places_alert_threshold: number;
    } | null;

    const llmRows = llmRes.data ?? [];
    const llm_cost_total_usd = llmRows.reduce((sum, r) => sum + ((r as { cost_usd: number }).cost_usd ?? 0), 0);

    const budget_remaining = config
      ? config.google_places_budget_total - config.google_places_budget_spent
      : null;

    return reply.status(200).send({
      data: {
        google_places: config
          ? {
              budget_total: config.google_places_budget_total,
              budget_spent: config.google_places_budget_spent,
              budget_remaining,
              alert_threshold: config.google_places_alert_threshold,
              over_alert: budget_remaining != null && budget_remaining < config.google_places_alert_threshold,
            }
          : null,
        llm: {
          total_calls: llmRows.length,
          total_cost_usd: Math.round(llm_cost_total_usd * 1_000_000) / 1_000_000,
        },
        ts: new Date().toISOString(),
      },
    });
  });

  // GET /admin/costs/history — LLM usage by month + Google Places by run
  app.get("/admin/costs/history", { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();

    const [llmRes, runsRes] = await Promise.all([
      db
        .from("llm_usage_log")
        .select("provider, model, operation, cost_usd, total_tokens, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("runs")
        .select("id, niche, location, status, stats, finished_at")
        .eq("status", "completed")
        .order("finished_at", { ascending: false })
        .limit(50),
    ]);

    // Group LLM by month
    const byMonth: Record<string, { cost_usd: number; calls: number; tokens: number }> = {};
    for (const row of llmRes.data ?? []) {
      const r = row as { cost_usd: number; total_tokens: number; created_at: string };
      const month = r.created_at.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = { cost_usd: 0, calls: 0, tokens: 0 };
      byMonth[month].cost_usd += r.cost_usd ?? 0;
      byMonth[month].calls++;
      byMonth[month].tokens += r.total_tokens ?? 0;
    }

    const gp_runs = (runsRes.data ?? []).map((r) => {
      const row = r as { id: string; niche: string; location: string; stats: Record<string, unknown> | null; finished_at: string };
      return {
        id: row.id,
        niche: row.niche,
        location: row.location,
        cost_usd: (row.stats?.["estimated_cost_usd"] as number | undefined) ?? 0,
        places_requests: (row.stats?.["places_requests"] as number | undefined) ?? 0,
        finished_at: row.finished_at,
      };
    });

    return reply.status(200).send({
      data: {
        llm_by_month: Object.entries(byMonth)
          .map(([month, s]) => ({ month, ...s }))
          .sort((a, b) => b.month.localeCompare(a.month)),
        google_places_runs: gp_runs,
      },
    });
  });
}
