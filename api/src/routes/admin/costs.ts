import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

type CostQuery = { month?: string };

type CostLead = {
  id: string;
  name: string | null;
  source: string | null;
  first_seen_run_id: string | null;
  created_at: string;
  prospect_score: number | null;
};

type CostRun = {
  id: string;
  niche: string | null;
  location: string | null;
  stats: Record<string, unknown> | null;
  finished_at: string | null;
};

type LlmUsageRow = {
  provider: string;
  lead_id: string | null;
  total_tokens: number | null;
  cost_usd: number;
  created_at: string;
};

const HOT_LEAD_THRESHOLD = 55;
const MONTH_RE = /^\d{4}-\d{2}$/;

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseMonthRange(rawMonth: string | undefined, now = new Date()) {
  if (rawMonth && MONTH_RE.test(rawMonth)) {
    const parts = rawMonth.split("-");
    const year = Number(parts[0] ?? 0);
    const month = Number(parts[1] ?? 1);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { month: rawMonth, start, end };
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    start,
    end,
  };
}

function isWithinRange(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const ts = new Date(value);
  return ts >= start && ts < end;
}

function toMonthKey(value: string | null | undefined): string | null {
  return value ? value.slice(0, 7) : null;
}

function buildMonthKeys(now = new Date(), count = 12): string[] {
  const keys: string[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let idx = 0; idx < count; idx += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - idx, 1));
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}


// N77/N55: PostgREST capa las respuestas a max_rows (1000) aunque pidas limit(20000).
// Paginar con range() es la única forma de traer el mes completo.
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function costsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/costs/overview", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { month, start, end } = parseMonthRange((request.query as CostQuery | undefined)?.month);
    try {
    // N77: el rango del mes va en SQL con paginación range() — la ventana latest-N
    // filtrada en JS subreportaba meses pasados hasta un 88% ($8.26 vs $68.11 en mayo)
    // y PostgREST capa a max_rows=1000 cualquier limit mayor.
    const [configRes, llmAll, runsAll, leadsAll] = await Promise.all([
      db
        .from("pipeline_config")
        .select(
          "google_places_budget_total, google_places_budget_spent, google_places_alert_threshold, infra_monthly_cost_usd, backup_monthly_cost_usd"
        )
        .limit(1)
        .single(),
      fetchAllRows<LlmUsageRow>((from, to) =>
        db
          .from("llm_usage_log")
          .select("provider, lead_id, total_tokens, cost_usd, created_at")
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows<CostRun>((from, to) =>
        db
          .from("runs")
          .select("id, niche, location, status, stats, finished_at")
          .eq("status", "completed")
          .gte("finished_at", start.toISOString())
          .lt("finished_at", end.toISOString())
          .order("finished_at", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows<CostLead>((from, to) =>
        db
          .from("leads")
          .select("id, name, source, first_seen_run_id, created_at, prospect_score")
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
    ]);

    const config = configRes.data as {
      google_places_budget_total: number;
      google_places_budget_spent: number;
      google_places_alert_threshold: number;
      infra_monthly_cost_usd: number;
      backup_monthly_cost_usd: number;
    } | null;

    const llmRowsInMonth = llmAll;
    const runsInMonth = runsAll;
    const leadsInMonth = leadsAll;

    const llmByProvider = new Map<
      string,
      { source: string; cost_usd: number; calls: number; tokens: number; lead_ids: Set<string> }
    >();
    const llmCostByLead = new Map<string, number>();
    let llmCostUsd = 0;

    for (const row of llmRowsInMonth) {
      const provider = row.provider || "unknown";
      const entry = llmByProvider.get(provider) ?? {
        source: provider,
        cost_usd: 0,
        calls: 0,
        tokens: 0,
        lead_ids: new Set<string>(),
      };
      const rowCost = asNumber(row.cost_usd);
      entry.cost_usd += rowCost;
      entry.calls += 1;
      entry.tokens += asNumber(row.total_tokens);
      if (row.lead_id) {
        entry.lead_ids.add(row.lead_id);
        llmCostByLead.set(row.lead_id, (llmCostByLead.get(row.lead_id) ?? 0) + rowCost);
      }
      llmByProvider.set(provider, entry);
      llmCostUsd += rowCost;
    }

    const runCostById = new Map<string, number>();
    let googlePlacesCostUsd = 0;
    let googlePlacesRequestCount = 0;

    for (const run of runsInMonth) {
      const stats = run.stats ?? {};
      const runCost = asNumber(stats["estimated_cost_usd"]);
      googlePlacesCostUsd += runCost;
      googlePlacesRequestCount += asNumber(stats["places_requests"]);
      runCostById.set(run.id, runCost);
    }

    const sourceLeadCounts = new Map<string, number>();
    const googlePlacesLeadCountsByRun = new Map<string, number>();
    const leadsById = new Map<string, CostLead>();
    let hotLeadsCount = 0;

    for (const lead of leadsInMonth) {
      leadsById.set(lead.id, lead);
      const source = lead.source ?? "unknown";
      sourceLeadCounts.set(source, (sourceLeadCounts.get(source) ?? 0) + 1);
      if (source === "google_places" && lead.first_seen_run_id && runCostById.has(lead.first_seen_run_id)) {
        googlePlacesLeadCountsByRun.set(
          lead.first_seen_run_id,
          (googlePlacesLeadCountsByRun.get(lead.first_seen_run_id) ?? 0) + 1
        );
      }
      if (asNumber(lead.prospect_score) >= HOT_LEAD_THRESHOLD) {
        hotLeadsCount += 1;
      }
    }

    const gpShareByLead = new Map<string, number>();
    for (const lead of leadsInMonth) {
      if (lead.source !== "google_places" || !lead.first_seen_run_id) continue;
      const runCost = runCostById.get(lead.first_seen_run_id);
      const runLeadCount = googlePlacesLeadCountsByRun.get(lead.first_seen_run_id) ?? 0;
      if (!runCost || runLeadCount <= 0) continue;
      gpShareByLead.set(lead.id, runCost / runLeadCount);
    }

    const topLeads = Array.from(new Set([...llmCostByLead.keys(), ...gpShareByLead.keys()]))
      .map((leadId) => {
        const lead = leadsById.get(leadId);
        const llmCost = llmCostByLead.get(leadId) ?? 0;
        const gpCostShare = gpShareByLead.get(leadId) ?? 0;
        return {
          lead_id: leadId,
          name: lead?.name ?? "Lead sin nombre",
          source: lead?.source ?? null,
          llm_cost_usd: roundMoney(llmCost),
          gp_cost_share_usd: roundMoney(gpCostShare),
          total_cost_usd: roundMoney(llmCost + gpCostShare),
        };
      })
      .sort((left, right) => right.total_cost_usd - left.total_cost_usd)
      .slice(0, 20);

    const budget_remaining = config
      ? config.google_places_budget_total - config.google_places_budget_spent
      : null;
    const infraUsd = config ? asNumber(config.infra_monthly_cost_usd) : 0;
    const backupUsd = config ? asNumber(config.backup_monthly_cost_usd) : 0;
    const variableCostUsd = llmCostUsd + googlePlacesCostUsd;
    const totalUsd = variableCostUsd + infraUsd + backupUsd;

    const perSource = [
      ...Array.from(sourceLeadCounts.entries()).map(([source, leads_count]) => ({
        source,
        cost_usd: roundMoney(source === "google_places" ? googlePlacesCostUsd : 0),
        leads_count,
      })),
      ...Array.from(llmByProvider.values()).map((entry) => ({
        source: entry.source,
        cost_usd: roundMoney(entry.cost_usd),
        leads_count: entry.lead_ids.size,
        calls: entry.calls,
        tokens: entry.tokens,
      })),
      { source: "infra", cost_usd: roundMoney(infraUsd), leads_count: 0 },
      { source: "backup", cost_usd: roundMoney(backupUsd), leads_count: 0 },
    ].sort((left, right) => {
      if (right.cost_usd !== left.cost_usd) return right.cost_usd - left.cost_usd;
      return left.source.localeCompare(right.source);
    });

    return reply.status(200).send({
      data: {
        month,
        totals: {
          llm_usd: roundMoney(llmCostUsd),
          google_places_usd: roundMoney(googlePlacesCostUsd),
          infra_usd: roundMoney(infraUsd),
          backup_usd: roundMoney(backupUsd),
          total_usd: roundMoney(totalUsd),
        },
        google_places: config
          ? {
              budget_total: config.google_places_budget_total,
              budget_spent: config.google_places_budget_spent,
              budget_remaining: roundMoney(budget_remaining ?? 0),
              alert_threshold: config.google_places_alert_threshold,
              request_count: googlePlacesRequestCount,
              over_alert: budget_remaining != null && budget_remaining < config.google_places_alert_threshold,
            }
          : null,
        llm: {
          total_calls: llmRowsInMonth.length,
          total_cost_usd: roundMoney(llmCostUsd),
          by_provider: Array.from(llmByProvider.values())
            .map((entry) => ({
              provider: entry.source,
              calls: entry.calls,
              tokens: entry.tokens,
              leads_count: entry.lead_ids.size,
              cost_usd: roundMoney(entry.cost_usd),
            }))
            .sort((left, right) => right.cost_usd - left.cost_usd),
        },
        infra: {
          infra_monthly_cost_usd: roundMoney(infraUsd),
          backup_monthly_cost_usd: roundMoney(backupUsd),
          total_monthly_cost_usd: roundMoney(infraUsd + backupUsd),
        },
        per_lead: {
          hot_leads_count: hotLeadsCount,
          total_cost_usd: roundMoney(variableCostUsd),
          cost_per_hot_usd: hotLeadsCount > 0 ? roundMoney(variableCostUsd / hotLeadsCount) : null,
          top_leads: topLeads,
        },
        per_source: perSource,
        ts: new Date().toISOString(),
      },
    });
    } catch (err) {
      request.log.error({ err }, "Failed to build costs overview");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });

  app.get("/admin/costs/history", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const historyNow = new Date();
    const historyStart = new Date(Date.UTC(historyNow.getUTCFullYear(), historyNow.getUTCMonth() - 11, 1));
    try {
    // N77: rango de 12 meses en SQL con paginación — el limit(500) erosionaba el histórico.
    const [configRes, llmAll, runsAll, leadsAll] = await Promise.all([
      db
        .from("pipeline_config")
        .select("infra_monthly_cost_usd, backup_monthly_cost_usd")
        .limit(1)
        .single(),
      fetchAllRows<LlmUsageRow>((from, to) =>
        db
          .from("llm_usage_log")
          .select("provider, lead_id, total_tokens, cost_usd, created_at")
          .gte("created_at", historyStart.toISOString())
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows<CostRun>((from, to) =>
        db
          .from("runs")
          .select("id, niche, location, status, stats, finished_at")
          .eq("status", "completed")
          .gte("finished_at", historyStart.toISOString())
          .order("finished_at", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows<CostLead>((from, to) =>
        db
          .from("leads")
          .select("id, name, source, first_seen_run_id, created_at, prospect_score")
          .gte("created_at", historyStart.toISOString())
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
    ]);

    const config = configRes.data as {
      infra_monthly_cost_usd: number;
      backup_monthly_cost_usd: number;
    } | null;
    const llmRows = llmAll;
    const runs = runsAll;
    const leads = leadsAll;
    const monthKeys = buildMonthKeys(new Date(), 12);
    const trackedMonths = new Set(monthKeys);

    const llmByMonth = new Map<string, number>();
    for (const row of llmRows) {
      const month = toMonthKey(row.created_at);
      if (!month || !trackedMonths.has(month)) continue;
      llmByMonth.set(month, (llmByMonth.get(month) ?? 0) + asNumber(row.cost_usd));
    }

    const gpByMonth = new Map<string, number>();
    for (const run of runs) {
      const month = toMonthKey(run.finished_at);
      if (!month || !trackedMonths.has(month)) continue;
      gpByMonth.set(month, (gpByMonth.get(month) ?? 0) + asNumber(run.stats?.["estimated_cost_usd"]));
    }

    const hotLeadsByMonth = new Map<string, number>();
    for (const lead of leads) {
      const month = toMonthKey(lead.created_at);
      if (!month || !trackedMonths.has(month) || asNumber(lead.prospect_score) < HOT_LEAD_THRESHOLD) continue;
      hotLeadsByMonth.set(month, (hotLeadsByMonth.get(month) ?? 0) + 1);
    }

    const infraUsd = config ? asNumber(config.infra_monthly_cost_usd) : 0;
    const backupUsd = config ? asNumber(config.backup_monthly_cost_usd) : 0;
    const monthly = monthKeys.map((month) => {
      const googlePlacesUsd = roundMoney(gpByMonth.get(month) ?? 0);
      const llmUsd = roundMoney(llmByMonth.get(month) ?? 0);
      return {
        month,
        google_places_usd: googlePlacesUsd,
        llm_usd: llmUsd,
        infra_usd: roundMoney(infraUsd),
        backup_usd: roundMoney(backupUsd),
        total_usd: roundMoney(googlePlacesUsd + llmUsd + infraUsd + backupUsd),
        hot_leads: hotLeadsByMonth.get(month) ?? 0,
      };
    });

    return reply.status(200).send({
      data: {
        monthly,
      },
    });
    } catch (err) {
      request.log.error({ err }, "Failed to build costs history");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });
}
