import type { PipelineRun } from "@/lib/api";

const PHASE_PRIORITY = [
  "invariant_check",
  "discovery",
  "enrich",
  "score",
  "outreach",
] as const;

export type RunPhaseSummary = {
  key: string;
  label: string;
  status: string;
  itemsProcessed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  metadataCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function humanizePhaseKey(value: string): string {
  return value.replaceAll("_", " ");
}

function inferPhaseStatus(result: Record<string, unknown>): string {
  const explicitStatus = asString(result["status"]);
  if (explicitStatus) return explicitStatus;
  if (asString(result["completed_at"])) return "completed";
  if (asString(result["started_at"])) return "running";
  return "pending";
}

export function summarizeRunPhases(phaseResults: PipelineRun["phase_results"]): RunPhaseSummary[] {
  const entries = Object.entries(phaseResults ?? {})
    .map(([key, value]) => {
      const result = asRecord(value);
      if (!result) return null;
      return {
        key,
        label: humanizePhaseKey(key),
        status: inferPhaseStatus(result),
        itemsProcessed: asNumber(result["items_processed"]),
        startedAt: asString(result["started_at"]),
        completedAt: asString(result["completed_at"]),
        metadataCount: Object.keys(result).length,
      } satisfies RunPhaseSummary;
    })
    .filter((entry): entry is RunPhaseSummary => entry !== null);

  return entries.sort((a, b) => {
    const aPriority = PHASE_PRIORITY.indexOf(a.key as typeof PHASE_PRIORITY[number]);
    const bPriority = PHASE_PRIORITY.indexOf(b.key as typeof PHASE_PRIORITY[number]);
    if (aPriority !== -1 || bPriority !== -1) {
      if (aPriority === -1) return 1;
      if (bPriority === -1) return -1;
      return aPriority - bPriority;
    }
    return a.label.localeCompare(b.label, "es");
  });
}

export function summarizeRunCard(run: PipelineRun) {
  const phases = summarizeRunPhases(run.phase_results);
  const completedPhases = phases.filter((phase) => phase.status === "completed").length;
  const runningPhase = phases.find((phase) => phase.status === "running")?.label ?? null;
  const requestedPhases = run.overrides?.phases?.length ? run.overrides.phases.length : null;

  return {
    phases,
    completedPhases,
    runningPhase,
    requestedPhases,
    isDryRun: Boolean(run.overrides?.dry_run),
  };
}
