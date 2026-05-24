import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { requireAdmin } from "../../auth/middleware.js";

const overviewQuerySchema = z.object({
  days: z.string().optional(),
});

const errorsQuerySchema = z.object({
  days: z.string().optional(),
  phase: z.string().trim().min(1).max(50).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  error_type: z.string().trim().min(1).max(80).optional(),
  recovered: z.enum(["true", "false"]).optional(),
  limit: z.string().optional(),
});

const qualityQuerySchema = z.object({
  run_id: z.string().trim().min(1).max(64).optional(),
  days: z.string().optional(),
});

type OverviewQuery = z.infer<typeof overviewQuerySchema>;
type ErrorsQuery = z.infer<typeof errorsQuerySchema>;
type QualityQuery = z.infer<typeof qualityQuerySchema>;

type PhaseStatus = "ok" | "skipped" | "failed";
type PipelineRunRow = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  phase_results: Record<string, { started_at?: string; completed_at?: string | null; status?: PhaseStatus; items_processed?: number } | undefined> | null;
};

type PipelineErrorRow = {
  id: string;
  occurred_at: string;
  run_id: string | null;
  phase: string;
  source: string | null;
  lead_id: string | null;
  error_type: string;
  message: string;
  stack: string | null;
  recovered: boolean;
};

type LeadRow = {
  id: string;
  name: string | null;
  source: string | null;
  updated_at: string;
  prospect_score: number | null;
  gps: unknown | null;
  inferred_state: Record<string, unknown> | null;
  digital_footprint: Record<string, unknown> | null;
  score_breakdown: Record<string, unknown> | null;
};

const DEFAULT_DAYS = 30;
const DEFAULT_ERROR_DAYS = 7;

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDays(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.round(parsed), 365);
}

function buildWindow(days: number, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

function inWindow(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const ts = new Date(value);
  return ts >= start && ts <= end;
}

function diffMinutes(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  return Math.max((new Date(end).getTime() - new Date(start).getTime()) / 60_000, 0);
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round((numerator / denominator) * 100, 1);
}

function coverageFor(leads: LeadRow[]) {
  const total = leads.length;
  const withEmailQuality = leads.filter((lead) =>
    Array.isArray(lead.digital_footprint?.["email_quality"]) &&
    (lead.digital_footprint?.["email_quality"] as Array<Record<string, unknown>>).some(
      (entry) => entry["quality"] !== "unknown"
    )
  ).length;
  const withPhoneType = leads.filter((lead) =>
    Array.isArray(lead.digital_footprint?.["phone_classification"]) &&
    (lead.digital_footprint?.["phone_classification"] as Array<Record<string, unknown>>).some(
      (entry) => entry["type"] !== "unknown"
    )
  ).length;
  const withCoords = leads.filter((lead) => lead.gps !== null).length;
  const withInferredState = leads.filter((lead) => lead.inferred_state !== null).length;
  const withContactTier = leads.filter((lead) => {
    const tier = lead.score_breakdown?.["contact_tier"];
    return typeof tier === "string" && tier !== "X";
  }).length;

  return {
    total_leads: total,
    email_quality_pct: toPct(withEmailQuality, total),
    phone_type_pct: toPct(withPhoneType, total),
    coords_pct: toPct(withCoords, total),
    inferred_state_pct: toPct(withInferredState, total),
    contactable_tier_pct: toPct(withContactTier, total),
  };
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function buildTrend(leads: LeadRow[], days: number, now = new Date()) {
  const rows: {
    day: string;
    email_quality_pct: number;
    phone_type_pct: number;
    coords_pct: number;
    inferred_state_pct: number;
    contactable_tier_pct: number;
  }[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const key = cursor.toISOString().slice(0, 10);
    const dayLeads = leads.filter((lead) => dayKey(lead.updated_at) === key);
    const coverage = coverageFor(dayLeads);
    rows.push({
      day: key,
      email_quality_pct: coverage.email_quality_pct,
      phone_type_pct: coverage.phone_type_pct,
      coords_pct: coverage.coords_pct,
      inferred_state_pct: coverage.inferred_state_pct,
      contactable_tier_pct: coverage.contactable_tier_pct,
    });
  }

  return rows;
}

function lastChangeDiff(lead: LeadRow) {
  const diff = lead.digital_footprint?.["last_change_diff"];
  return diff && typeof diff === "object" ? diff as Record<string, unknown> : null;
}

function changeTierRank(value: unknown): number {
  switch (value) {
    case "A": return 4;
    case "B": return 3;
    case "C": return 2;
    case "D": return 1;
    case "X": return 0;
    default: return -1;
  }
}

function selectRunWindow(runs: PipelineRunRow[], requestedRunId: string | undefined, fallbackDays: number) {
  const sorted = runs
    .filter((run) => run.completed_at !== null)
    .slice()
    .sort((left, right) => new Date(right.completed_at ?? right.created_at).getTime() - new Date(left.completed_at ?? left.created_at).getTime());

  const run = requestedRunId
    ? sorted.find((entry) => entry.id === requestedRunId) ?? null
    : sorted[0] ?? null;

  if (!run) {
    const { start, end } = buildWindow(fallbackDays);
    return { run: null, start, end };
  }

  return {
    run,
    start: new Date(run.started_at ?? run.created_at),
    end: new Date(run.completed_at ?? run.created_at),
  };
}

export async function performanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/performance/overview", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const queryParse = overviewQuerySchema.safeParse(request.query ?? {});
    if (!queryParse.success) {
      return reply.code(400).send({ error: "Invalid query", issues: queryParse.error.flatten() });
    }
    const days = parseDays(queryParse.data.days, DEFAULT_DAYS);
    const { start, end } = buildWindow(days);

    const [runsRes, errorsRes, leadsRes] = await Promise.all([
      db.from("pipeline_runs").select("id, status, created_at, started_at, completed_at, phase_results").order("created_at", { ascending: false }).limit(200),
      db.from("pipeline_errors").select("id, occurred_at, run_id, phase, source, lead_id, error_type, message, stack, recovered").order("occurred_at", { ascending: false }).limit(5000),
      db.from("leads").select("id, name, source, updated_at, prospect_score, gps, inferred_state, digital_footprint, score_breakdown").order("updated_at", { ascending: false }).limit(5000),
    ]);

    const runs = ((runsRes.data ?? []) as PipelineRunRow[]).filter((run) => inWindow(run.created_at, start, end));
    const errors = ((errorsRes.data ?? []) as PipelineErrorRow[]).filter((row) => inWindow(row.occurred_at, start, end));
    const leads = ((leadsRes.data ?? []) as LeadRow[]).filter((lead) => inWindow(lead.updated_at, start, end));

    const statusCounts = {
      total: runs.length,
      successful: runs.filter((run) => run.status === "completed").length,
      failed: runs.filter((run) => run.status === "failed").length,
      partial: runs.filter((run) => run.status === "partial").length,
      aborted: runs.filter((run) => run.status === "aborted").length,
      pending: runs.filter((run) => run.status === "pending").length,
      running: runs.filter((run) => run.status === "running").length,
    };

    const completedRuns = runs.filter((run) => run.started_at && run.completed_at);
    const totalMinutes = completedRuns.reduce((sum, run) => sum + diffMinutes(run.started_at, run.completed_at), 0);
    const avgMinutes = completedRuns.length > 0 ? totalMinutes / completedRuns.length : 0;

    const phaseNames = ["refresh", "discovery", "enrich", "score", "invariant_check"] as const;
    const perPhase = phaseNames.map((phase) => {
      let phaseMinutes = 0;
      let phaseRuns = 0;
      let itemsProcessed = 0;

      for (const run of completedRuns) {
        const result = run.phase_results?.[phase];
        if (!result || result.status === "skipped") continue;
        phaseMinutes += diffMinutes(result.started_at, result.completed_at ?? null);
        phaseRuns += 1;
        itemsProcessed += asNumber(result.items_processed);
      }

      const avg_min = phaseRuns > 0 ? phaseMinutes / phaseRuns : 0;
      return {
        phase,
        avg_min: round(avg_min, 1),
        pct_of_total: totalMinutes > 0 ? round((phaseMinutes / totalMinutes) * 100, 1) : 0,
        runs: phaseRuns,
        items_processed: itemsProcessed,
        total_minutes: phaseMinutes,
      };
    });

    const enrichPhase = perPhase.find((entry) => entry.phase === "enrich");
    const scorePhase = perPhase.find((entry) => entry.phase === "score");
    const discoveryPhase = perPhase.find((entry) => entry.phase === "discovery");

    const sourceTotals = new Map<string, Set<string>>();
    const sourceFailures = new Map<string, Set<string>>();
    for (const lead of leads) {
      const source = lead.source ?? "unknown";
      const totalSet = sourceTotals.get(source) ?? new Set<string>();
      totalSet.add(lead.id);
      sourceTotals.set(source, totalSet);
    }
    for (const error of errors) {
      const source = error.source ?? "unknown";
      const failureSet = sourceFailures.get(source) ?? new Set<string>();
      failureSet.add(error.lead_id ?? error.id);
      sourceFailures.set(source, failureSet);
    }

    const success_rate_per_source = Array.from(sourceTotals.entries())
      .map(([source, totalSet]) => {
        const total = totalSet.size;
        const failures = sourceFailures.get(source)?.size ?? 0;
        const success = Math.max(total - failures, 0);
        return {
          source,
          success,
          total,
          errors: failures,
          pct: toPct(success, total),
        };
      })
      .sort((left, right) => right.total - left.total || left.source.localeCompare(right.source));

    return reply.status(200).send({
      data: {
        days,
        runs: statusCounts,
        duration: {
          avg_min: round(avgMinutes, 1),
          total_hours: round(totalMinutes / 60, 2),
        },
        per_phase: perPhase.map(({ phase, avg_min, pct_of_total, runs: phaseRuns }) => ({
          phase,
          avg_min,
          pct_of_total,
          runs: phaseRuns,
        })),
        throughput: {
          enrich_per_hour: enrichPhase && enrichPhase.total_minutes > 0
            ? round(enrichPhase.items_processed / (enrichPhase.total_minutes / 60), 1)
            : 0,
          score_per_hour: scorePhase && scorePhase.total_minutes > 0
            ? round(scorePhase.items_processed / (scorePhase.total_minutes / 60), 1)
            : 0,
          discovery_per_min: discoveryPhase && discoveryPhase.total_minutes > 0
            ? round(discoveryPhase.items_processed / discoveryPhase.total_minutes, 2)
            : 0,
        },
        success_rate_per_source,
        ts: new Date().toISOString(),
      },
    });
  });

  app.get("/admin/performance/errors", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const queryParse = errorsQuerySchema.safeParse(request.query ?? {});
    if (!queryParse.success) {
      return reply.code(400).send({ error: "Invalid query", issues: queryParse.error.flatten() });
    }
    const query: ErrorsQuery = queryParse.data;
    const days = parseDays(query.days, DEFAULT_ERROR_DAYS);
    const limit = Math.min(Math.max(Number(query.limit ?? "50"), 1), 200);
    const recoveredFilter = query.recovered === undefined
      ? null
      : query.recovered === "true";
    const { start, end } = buildWindow(days);

    const result = await db
      .from("pipeline_errors")
      .select("id, occurred_at, run_id, phase, source, lead_id, error_type, message, stack, recovered")
      .order("occurred_at", { ascending: false })
      .limit(5000);

    const rows = ((result.data ?? []) as PipelineErrorRow[])
      .filter((row) => inWindow(row.occurred_at, start, end))
      .filter((row) => query.phase ? row.phase === query.phase : true)
      .filter((row) => query.source ? row.source === query.source : true)
      .filter((row) => query.error_type ? row.error_type === query.error_type : true)
      .filter((row) => recoveredFilter === null ? true : row.recovered === recoveredFilter)
      .slice(0, limit);

    return reply.status(200).send({
      data: rows.map((row) => ({
        id: row.id,
        ts: row.occurred_at,
        run_id: row.run_id,
        phase: row.phase,
        source: row.source,
        lead_id: row.lead_id,
        error_type: row.error_type,
        message: row.message,
        stack: row.stack,
        recovered: row.recovered,
      })),
      total: rows.length,
      filters: {
        days,
        phase: query.phase ?? null,
        source: query.source ?? null,
        error_type: query.error_type ?? null,
        recovered: recoveredFilter,
      },
    });
  });

  app.get("/admin/performance/quality", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const queryParse = qualityQuerySchema.safeParse(request.query ?? {});
    if (!queryParse.success) {
      return reply.code(400).send({ error: "Invalid query", issues: queryParse.error.flatten() });
    }
    const query: QualityQuery = queryParse.data;
    const days = parseDays(query.days, DEFAULT_DAYS);

    const [runsRes, leadsRes] = await Promise.all([
      db.from("pipeline_runs").select("id, status, created_at, started_at, completed_at, phase_results").order("created_at", { ascending: false }).limit(200),
      db.from("leads").select("id, name, source, updated_at, prospect_score, gps, inferred_state, digital_footprint, score_breakdown").order("updated_at", { ascending: false }).limit(5000),
    ]);

    const runs = (runsRes.data ?? []) as PipelineRunRow[];
    const leads = (leadsRes.data ?? []) as LeadRow[];
    const { run, start, end } = selectRunWindow(runs, query.run_id, days);
    const coverageWindow = buildWindow(days);

    const changedLeads = leads.filter((lead) => {
      const diff = lastChangeDiff(lead);
      const changedAt = typeof diff?.["changed_at"] === "string" ? diff["changed_at"] : null;
      return inWindow(lead.updated_at, start, end) && inWindow(changedAt, start, end);
    });

    let tierGained = 0;
    let tierLost = 0;
    let newHot = 0;
    const byField = new Map<string, number>();
    const significantChanges: Array<{
      lead_id: string;
      name: string;
      source: string | null;
      changed_at: string;
      field: string;
      from: unknown;
      to: unknown;
      prospect_score: number | null;
      contact_tier: string | null;
    }> = [];

    for (const lead of changedLeads) {
      const diff = lastChangeDiff(lead);
      if (!diff) continue;
      const changedAt = typeof diff["changed_at"] === "string" ? diff["changed_at"] : lead.updated_at;
      const contactTier = typeof lead.score_breakdown?.["contact_tier"] === "string"
        ? lead.score_breakdown["contact_tier"] as string
        : null;

      const changes = Array.isArray(diff["changes"]) ? diff["changes"] as Array<Record<string, unknown>> : [];
      let leadIsHot = false;

      for (const change of changes) {
        const field = typeof change["field"] === "string" ? change["field"] : "unknown";
        byField.set(field, (byField.get(field) ?? 0) + 1);
        significantChanges.push({
          lead_id: lead.id,
          name: lead.name ?? "Lead sin nombre",
          source: lead.source ?? null,
          changed_at: changedAt,
          field,
          from: change["from"] ?? null,
          to: change["to"] ?? null,
          prospect_score: lead.prospect_score,
          contact_tier: contactTier,
        });

        if (field === "contact_tier") {
          const fromRank = changeTierRank(change["from"]);
          const toRank = changeTierRank(change["to"]);
          if (toRank > fromRank) tierGained += 1;
          if (toRank < fromRank) tierLost += 1;
        }

        if (!leadIsHot && asNumber(lead.prospect_score) >= 55) {
          leadIsHot = true;
          newHot += 1;
        }
      }
    }

    const coverageLeads = leads.filter((lead) => inWindow(lead.updated_at, coverageWindow.start, coverageWindow.end));

    return reply.status(200).send({
      data: {
        run_id: run?.id ?? null,
        window: run
          ? {
              started_at: run.started_at ?? run.created_at,
              completed_at: run.completed_at,
            }
          : null,
        coverage: coverageFor(coverageLeads),
        trend: buildTrend(coverageLeads, Math.min(days, 30)),
        changes: {
          significant_total: significantChanges.length,
          score_up_15: 0,
          score_down_15: 0,
          tier_gained: tierGained,
          tier_lost: tierLost,
          new_hot: newHot,
          by_field: Array.from(byField.entries()).map(([field, count]) => ({ field, count })),
          significant_changes: significantChanges.slice(0, 100),
        },
        ts: new Date().toISOString(),
      },
    });
  });
}
