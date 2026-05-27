"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getMonitoringDiscoveryJobs,
  getMonitoringOverview,
  getPipelineRun,
  getPipelineRunLog,
  listPipelineRuns,
  resetDatabase,
  restartAll,
  restartSystemProcess,
  type DiscoveryJobsSummary,
  type MonitoringOverview,
  type PipelineLogLine,
  type PipelineRun,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatBackupSize } from "@/lib/backups";
import { summarizeRunCard } from "@/lib/monitoring-runs";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { SectionCard, StatCard } from "@/components/admin-shell";

const RUN_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-50 text-yellow-700",
  running: "bg-blue-50 text-blue-700 animate-pulse",
  completed: "bg-green-50 text-green-700",
  partial: "bg-orange-50 text-orange-700",
  failed: "bg-red-50 text-red-700",
  aborted: "bg-gray-50 text-gray-600",
};

const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  running: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
};

export function MonitoringSection() {
  const token = useAuthStore((s) => s.token);
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [restartTarget, setRestartTarget] = useState<"core" | "api" | null>(null);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
  const [runLogs, setRunLogs] = useState<PipelineLogLine[]>([]);
  const runPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [jobsSummary, setJobsSummary] = useState<DiscoveryJobsSummary | null>(null);
  const [jobsTab, setJobsTab] = useState<string>("queued");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetRunning, setResetRunning] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [restartAllRunning, setRestartAllRunning] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await getMonitoringOverview(token);
      setOverview(res.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar monitoreo");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const loadRuns = useCallback(async () => {
    if (!token) return;
    try {
      const res = await listPipelineRuns(token, { limit: 10 });
      setRuns(res.data);
      setSelectedRun((current) => current ? res.data.find((run) => run.id === current.id) ?? current : res.data[0] ?? null);
    } catch {
      // non-blocking: run status is best-effort
    }
  }, [token]);

  const loadRunDetail = useCallback(async (runId: string) => {
    if (!token) return;
    try {
      const [runRes, logRes] = await Promise.all([
        getPipelineRun(token, runId),
        getPipelineRunLog(token, runId),
      ]);
      setSelectedRun(runRes.data);
      setRunLogs(logRes.data);
    } catch {
      // non-blocking
    }
  }, [token]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRun?.id) return;
    void loadRunDetail(selectedRun.id);
  }, [loadRunDetail, selectedRun?.id]);

  useEffect(() => {
    runPollRef.current = setInterval(() => {
      void loadRuns();
      if (selectedRun?.id) void loadRunDetail(selectedRun.id);
    }, 5000);
    return () => {
      if (runPollRef.current) clearInterval(runPollRef.current);
    };
  }, [loadRunDetail, loadRuns, selectedRun?.id]);

  const loadJobsSummary = useCallback(async () => {
    if (!token) return;
    try {
      const res = await getMonitoringDiscoveryJobs(token);
      setJobsSummary(res.data);
    } catch {
      // non-blocking
    }
  }, [token]);

  useEffect(() => {
    void loadJobsSummary();
    const interval = setInterval(() => void loadJobsSummary(), 30000);
    return () => clearInterval(interval);
  }, [loadJobsSummary]);

  const handleRestart = useCallback(async (target: "core" | "api") => {
    if (!token) return;
    if (!window.confirm(`Esto reinicia el proceso ${target}. ¿Continuar?`)) return;

    setRestartTarget(target);
    setRestartMessage(null);
    setError(null);

    try {
      const result = await restartSystemProcess(token, target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRestartMessage(`Restart de ${target} solicitado. Verificando estado...`);
    } catch (err) {
      if (target === "api" && !(err instanceof ApiError)) {
        setRestartMessage("Restart de api iniciado. Esperando reconexión del servicio...");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : `Error al reiniciar ${target}`);
      }
    }

    window.setTimeout(() => {
      void refresh();
      setRestartTarget(null);
    }, 10_000);
  }, [refresh, token]);

  async function handleRestartAll() {
    if (!token) return;
    setRestartAllRunning(true);
    try {
      await restartAll(token);
      setRestartMessage("Restart de todos los procesos solicitado.");
    } catch {
      setRestartMessage("Error al reiniciar todos los procesos.");
    } finally {
      setRestartAllRunning(false);
      window.setTimeout(() => void refresh(), 12_000);
    }
  }

  async function handleResetDb() {
    if (!token) return;
    if (resetConfirm.trim().toLowerCase() !== "reset") return;
    setResetRunning(true);
    setResetMessage(null);
    try {
      await resetDatabase(token);
      setResetMessage("Reset de DB iniciado. El sistema se reconectará en unos minutos.");
    } catch (err) {
      setResetMessage(`Error al ejecutar reset-db: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResetRunning(false);
      setResetConfirm("");
    }
  }

  const statusTone = overview?.status === "degraded" ? "warn" : "good";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {lastRefresh ? <span className="text-xs theme-text-muted">Actualizado {formatRelative(lastRefresh.toISOString())}</span> : null}
        <button onClick={() => void refresh()} className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">
          Refrescar
        </button>
        <Link href="/admin/backups" className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">
          Abrir backups
        </Link>
      </div>

      {error ? <Banner tone="error" text={error} /> : null}
      {restartMessage ? <Banner tone="info" text={restartMessage} /> : null}

      {overview ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Estado global" value={overview.status === "degraded" ? "Degradado" : "Operativo"} hint={`DB ${overview.health.db_connected ? "conectada" : "con error"}`} tone={statusTone} />
            <StatCard label="Latencia DB" value={`${overview.health.db_latency_ms.toFixed(1)} ms`} hint={overview.health.cron_missed ? "Cron atrasado" : "Cron dentro de ventana"} tone={overview.health.cron_missed ? "warn" : "info"} />
            <StatCard label="Run activo" value={overview.pipeline.active_run ? overview.pipeline.active_run.status : "Ninguno"} hint={overview.pipeline.active_run ? overview.pipeline.active_run.id.slice(0, 8) : "Sin ejecución en curso"} tone={overview.pipeline.active_run ? "warn" : "default"} />
            <StatCard label="Budget GP" value={overview.costs.google_places.budget_remaining != null ? `USD ${overview.costs.google_places.budget_remaining.toFixed(2)}` : "n/a"} hint={`${overview.costs.google_places.request_count} requests este mes`} tone={overview.costs.google_places.over_alert ? "warn" : "good"} />
            <StatCard label="Errores recientes" value={overview.logs.recent.length} hint={`Ventana ${overview.performance.window_days} días`} tone={overview.logs.recent.length > 0 ? "warn" : "default"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
            <SectionCard title="Alertas activas" description="Nada se esconde detrás de un badge verde genérico.">
              <div className="space-y-3">
                {collectAlerts(overview).length === 0 ? (
                  <Banner tone="success" text="Sin alertas críticas activas en este momento." />
                ) : (
                  collectAlerts(overview).map((alert, index) => <Banner key={`${alert}-${index}`} tone="warn" text={alert} />)
                )}
              </div>
            </SectionCard>

            <SectionCard title="Operación" description="Configuración crítica visible para operar sin salir a otras pantallas.">
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <InfoRow label="Proveedor IA" value={overview.operational.llm.provider_active} />
                <InfoRow label="Modelo IA" value={overview.operational.llm.model ?? "template / fallback"} />
                <InfoRow label="Webhook" value={overview.operational.webhook.configured ? "configurado" : "sin configurar"} />
                <InfoRow label="Eventos webhook" value={overview.operational.webhook.events.join(", ") || "—"} />
                <InfoRow label="Concurrency discovery" value={String(overview.operational.concurrency.discovery_default)} />
                <InfoRow label="Workers activos" value={String(overview.operational.concurrency.active_pipeline_workers)} />
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
            <SectionCard title="Procesos y scheduler" description="Estado vivo de API, core, DB y cron operativo.">
              <div className="space-y-3">
                <ProcessCard name="api" process={overview.processes.api} onRestart={() => void handleRestart("api")} disabled={restartTarget !== null} pending={restartTarget === "api"} />
                <ProcessCard name="core" process={overview.processes.core} onRestart={() => void handleRestart("core")} disabled={restartTarget !== null} pending={restartTarget === "core"} />
                <ProcessCard name="db" process={overview.processes.db} disabled pending={false} />
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <InfoRow label="Cron" value={overview.pipeline.cron_enabled ? "habilitado" : "deshabilitado"} />
                  <InfoRow label="Expresión" value={overview.pipeline.cron_expression ?? "—"} />
                  <InfoRow label="Próximo run" value={formatDate(overview.pipeline.next_run_at)} />
                  <InfoRow label="Último completo" value={formatDate(overview.pipeline.last_completed_at)} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Pipeline y discovery" description="Backlog y actividad reciente concentrados en un mismo panel.">
              <div className="grid gap-4 lg:grid-cols-2">
                <ListCard title="Runs recientes" items={overview.pipeline.recent.slice(0, 5).map((run) => `${run.status} · ${run.triggered_by} · ${formatRelative(run.created_at)}`)} />
                <ListCard title="Discovery fallido" items={overview.discovery.recent_failed.map((job) => `${job.source} · ${job.location} · ${job.error_message ?? job.status}`)} />
                <ListCard title="Discovery manual" items={overview.discovery.recent_manual.map((job) => `${job.source} · ${job.location} · ${job.status}`)} />
                <ListCard title="Runs por origen" items={Object.entries(overview.pipeline.runs_by_trigger).map(([key, summary]) => `${key}: ${summary.total} · último ${summary.last_status ?? "—"}`)} />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {Object.entries(overview.discovery.summary).map(([key, count]) => (
                  <MetricChip key={key} label={key} value={count} />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
            <SectionCard title="Backups y restore" description="Scheduler, retención actual y salud del último restore.">
              {overview.backups ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoRow label="Directorio" value={overview.backups.config.directory} />
                    <InfoRow label="Directorio válido" value={overview.backups.config.directory_valid ? "sí" : "no"} />
                    <InfoRow label="Próximo backup" value={formatDate(overview.backups.config.next_backup_at)} />
                    <InfoRow label="Máximo legado" value={String(overview.backups.config.max_backups)} />
                    <InfoRow label="Máximo manual" value={String(overview.backups.config.max_manual_backups)} />
                    <InfoRow label="Máximo programado" value={String(overview.backups.config.max_scheduled_backups)} />
                    <InfoRow label="Backups presentes" value={String(overview.backups.summary.backup_count)} />
                    <InfoRow label="Peso DB" value={formatBackupSize(overview.backups.summary.database_size_bytes)} />
                    <InfoRow label="Backups retenidos" value={formatBackupSize(overview.backups.summary.stored_backup_size_bytes)} />
                    <InfoRow label="Manual en retención" value={`${overview.backups.summary.retention.manual.count}/${overview.backups.summary.retention.manual.max}`} />
                    <InfoRow label="Programados en retención" value={`${overview.backups.summary.retention.scheduled.count}/${overview.backups.summary.retention.scheduled.max}`} />
                    <InfoRow label="Checkpoints restore" value={String(overview.backups.summary.restore_checkpoint_count)} />
                    <InfoRow label="Restore activo" value={overview.backups.restore.active ? overview.backups.restore.active.status : "ninguno"} />
                  </div>
                  <ListCard title="Alertas de backups" items={overview.backups.alerts.length > 0 ? overview.backups.alerts : ["Sin alertas de backups"]} />
                </div>
              ) : (
                <Banner tone="warn" text="No se pudo construir el overview de backups." />
              )}
            </SectionCard>

            <SectionCard title="Costos y performance" description="Resumen operativo para decidir sin saltar entre costos y calidad.">
              <div className="grid gap-3 md:grid-cols-2">
                <InfoRow label="Mes" value={overview.costs.month} />
                <InfoRow label="Costo total" value={`USD ${overview.costs.totals.total_usd.toFixed(2)}`} />
                <InfoRow label="LLM" value={`USD ${overview.costs.totals.llm_usd.toFixed(2)}`} />
                <InfoRow label="Google Places" value={`USD ${overview.costs.totals.google_places_usd.toFixed(2)}`} />
                <InfoRow label="Duración promedio run" value={`${overview.performance.duration.avg_min.toFixed(1)} min`} />
                <InfoRow label="Horas totales" value={`${overview.performance.duration.total_hours.toFixed(2)} h`} />
                <InfoRow label="Enrich / hora" value={String(overview.performance.throughput.enrich_per_hour)} />
                <InfoRow label="Score / hora" value={String(overview.performance.throughput.score_per_hour)} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/admin/costs" className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">Ver costos</Link>
                <Link href="/admin/performance" className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">Ver performance</Link>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Acciones del sistema" description="Reiniciar procesos o ejecutar reset de DB con confirmación explícita.">
            <div className="space-y-4">
              {resetMessage ? <Banner tone="info" text={resetMessage} /> : null}
              <div className="flex flex-wrap gap-3">
                <button onClick={() => void handleRestart("api")} disabled={restartTarget !== null} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  {restartTarget === "api" ? "Reiniciando API…" : "Reiniciar API"}
                </button>
                <button onClick={() => void handleRestart("core")} disabled={restartTarget !== null} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  {restartTarget === "core" ? "Reiniciando Core…" : "Reiniciar Core"}
                </button>
                <button onClick={() => void handleRestartAll()} disabled={restartAllRunning} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  {restartAllRunning ? "Reiniciando…" : "Reiniciar todo"}
                </button>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-rose-900">Reset de base de datos</p>
                <p className="text-xs text-rose-700">Esta acción es destructiva e irreversible en datos locales. Borra todo y vuelve a correr las migraciones desde cero.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    placeholder='Escribí "reset" para confirmar'
                    className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  />
                  <button
                    onClick={() => void handleResetDb()}
                    disabled={resetRunning || resetConfirm.trim().toLowerCase() !== "reset"}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {resetRunning ? "Ejecutando…" : "Ejecutar Reset DB"}
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Estado del run" description="Seguimiento en vivo del último run o el seleccionado — actualizado cada 5 s.">
            {!selectedRun ? (
              <p className="text-sm theme-text-muted">Sin runs recientes.</p>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const selectedSummary = summarizeRunCard(selectedRun);
                  return (
                    <>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", RUN_STATUS_COLORS[selectedRun.status === "pending" ? "queued" : selectedRun.status] ?? "bg-slate-100 text-slate-700")}>{selectedRun.status === "pending" ? "queued" : selectedRun.status}</span>
                              {selectedSummary.isDryRun ? <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">dry run</span> : null}
                              {selectedRun.dashboard_stale ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">dashboard stale</span> : null}
                            </div>
                            <p className="mt-3 font-mono text-xs text-slate-500">{selectedRun.id}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">Disparado por {selectedRun.triggered_by}</p>
                          </div>
                          <div className="ml-auto grid gap-2 text-right text-xs text-slate-500 sm:grid-cols-2 sm:text-left">
                            <div>
                              <div className="font-semibold uppercase tracking-wide text-slate-400">Fases</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{selectedSummary.completedPhases}/{selectedSummary.phases.length || 0} completas</div>
                            </div>
                            <div>
                              <div className="font-semibold uppercase tracking-wide text-slate-400">Activa</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{selectedSummary.runningPhase ?? "sin fase corriendo"}</div>
                            </div>
                            <div>
                              <div className="font-semibold uppercase tracking-wide text-slate-400">Override</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{selectedSummary.requestedPhases ? `${selectedSummary.requestedPhases} fases pedidas` : "pipeline completo"}</div>
                            </div>
                            <div>
                              <div className="font-semibold uppercase tracking-wide text-slate-400">Duración</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{selectedRun.started_at ? selectedRun.completed_at ? `${Math.max(Math.round((new Date(selectedRun.completed_at).getTime() - new Date(selectedRun.started_at).getTime()) / 60000), 0)} min` : "en curso" : "en cola"}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {[
                          { label: "Creado", value: formatRelative(selectedRun.created_at) },
                          { label: "Inicio", value: selectedRun.started_at ? formatRelative(selectedRun.started_at) : "En cola" },
                          { label: "Fin", value: selectedRun.completed_at ? formatRelative(selectedRun.completed_at) : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-xl border px-3 py-3 theme-panel">
                            <div className="text-xs font-semibold uppercase tracking-wide theme-text-muted">{label}</div>
                            <div className="mt-1 text-sm theme-text-strong">{value}</div>
                          </div>
                        ))}
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Runs recientes</div>
                        <div className="overflow-x-auto pb-2">
                          <div className="flex min-w-max gap-3">
                            {runs.slice(0, 6).map((run) => {
                              const summary = summarizeRunCard(run);
                              const active = selectedRun.id === run.id;
                              return (
                                <button
                                  key={run.id}
                                  onClick={() => void loadRunDetail(run.id)}
                                  className={cn(
                                    "w-[20rem] shrink-0 rounded-2xl border px-4 py-3 text-left transition-colors",
                                    active ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40"
                                  )}
                                >
                                  <div className="flex items-start gap-3">
                                    <div>
                                      <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", RUN_STATUS_COLORS[run.status === "pending" ? "queued" : run.status] ?? "bg-slate-100 text-slate-700")}>{run.status === "pending" ? "queued" : run.status}</span>
                                      <p className="mt-3 font-mono text-[11px] text-slate-500">{run.id.slice(0, 8)}</p>
                                      <p className="mt-1 text-sm font-semibold text-slate-900">{run.triggered_by}</p>
                                    </div>
                                    <div className="ml-auto text-right text-xs text-slate-500">
                                      <div>{formatRelative(run.created_at)}</div>
                                      <div className="mt-1">{summary.completedPhases}/{summary.phases.length || 0} fases</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                                      <div className="font-semibold uppercase tracking-wide text-slate-400">Activa</div>
                                      <div className="mt-1 text-slate-800">{summary.runningPhase ?? "sin fase"}</div>
                                    </div>
                                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                                      <div className="font-semibold uppercase tracking-wide text-slate-400">Modo</div>
                                      <div className="mt-1 text-slate-800">{summary.isDryRun ? "dry run" : "real"}</div>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fases</div>
                        {selectedSummary.phases.length === 0 ? (
                          <p className="text-sm text-slate-500">Sin phase_results todavía.</p>
                        ) : (
                          <div className="overflow-x-auto pb-2">
                            <div className="flex min-w-max gap-3">
                              {selectedSummary.phases.map((phase) => (
                                <div key={phase.key} className="w-[15rem] shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold capitalize text-slate-900">{phase.label}</p>
                                    <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", PHASE_STATUS_COLORS[phase.status] ?? "bg-slate-100 text-slate-700")}>{phase.status}</span>
                                  </div>
                                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                                    <div>Items: <span className="font-medium text-slate-800">{phase.itemsProcessed ?? "—"}</span></div>
                                    <div>Inicio: <span className="font-medium text-slate-800">{phase.startedAt ? formatDate(phase.startedAt) : "—"}</span></div>
                                    <div>Fin: <span className="font-medium text-slate-800">{phase.completedAt ? formatDate(phase.completedAt) : "—"}</span></div>
                                    <div>Metadata: <span className="font-medium text-slate-800">{phase.metadataCount} campos</span></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
                <div className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Log en vivo</div>
                    <div className="max-h-64 space-y-1 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-200">
                      {runLogs.length === 0 ? (
                        <div className="text-slate-500">Sin líneas todavía.</div>
                      ) : runLogs.map((line, index) => (
                        <div key={`${line.ts ?? "line"}-${index}`}>
                          <span className="text-slate-500">[{line.ts ? new Date(line.ts).toLocaleTimeString("es-UY") : "--:--:--"}]</span>{" "}
                          <span className="text-sky-300">{line.level ?? "info"}</span>{" "}
                          <span>{line.msg ?? JSON.stringify(line)}</span>
                        </div>
                      ))}
                    </div>
                </div>
              </div>
            )}
          </SectionCard>

          {jobsSummary ? (
            <SectionCard title="Discovery jobs" description="Jobs por estado — actualizado cada 30 s.">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(["queued", "running", "completed", "failed"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setJobsTab(s)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        jobsTab === s ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 hover:bg-slate-50 theme-text-muted"
                      )}
                    >
                      {s} <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">{jobsSummary.counts[s] ?? 0}</span>
                    </button>
                  ))}
                </div>
                {(jobsSummary.by_status[jobsTab] ?? []).length === 0 ? (
                  <p className="text-sm theme-text-muted">Sin jobs con estado &quot;{jobsTab}&quot;.</p>
                ) : (
                  <div className="space-y-2">
                    {(jobsSummary.by_status[jobsTab] ?? []).map((job) => (
                      <div key={job.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium theme-text-strong">{job.location}</span>
                          {job.niche ? <span className="text-xs theme-text-muted">· {job.niche}</span> : null}
                          <span className="text-xs theme-text-muted">· {job.source}</span>
                          <span className="ml-auto text-xs theme-text-muted">{formatRelative(job.created_at)}</span>
                        </div>
                        {job.error_message ? <p className="mt-1 text-xs text-rose-600">{job.error_message}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Logs recientes" description="Errores operativos recientes listos para drill-down técnico.">
            <div className="space-y-3">
              {overview.logs.recent.length === 0 ? (
                <Banner tone="success" text="Sin errores recientes en la ventana operativa actual." />
              ) : (
                overview.logs.recent.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-800">{entry.phase} · {entry.error_type}</div>
                      <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", entry.recovered ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{entry.recovered ? "recuperado" : "abierto"}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{entry.message}</p>
                    <p className="mt-2 text-xs text-slate-500">{entry.source ?? "sin fuente"} · {formatRelative(entry.occurred_at)} · run {entry.run_id ?? "—"}</p>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </>
      ) : (
        !error ? <div className="text-sm theme-text-muted">Cargando monitoreo…</div> : null
      )}
    </div>
  );
}

function collectAlerts(overview: MonitoringOverview) {
  return [
    overview.health.cron_missed ? "El cron debería haber corrido y no lo hizo dentro de la ventana esperada." : null,
    overview.health.dashboard_stale ? "El dashboard quedó marcado como stale en el último run." : null,
    ...overview.health.backup_alerts.map((alert) => `Backups: ${alert}`),
    ...overview.performance.recent_errors.filter((entry) => !entry.recovered).map((entry) => `${entry.phase}: ${entry.message}`),
  ].filter((value): value is string => value !== null);
}

function Banner({ tone, text }: { tone: "warn" | "info" | "error" | "success"; text: string }) {
  return (
    <div className={cn(
      "rounded-xl border px-4 py-3 text-sm",
      tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
      tone === "info" && "border-sky-200 bg-sky-50 text-sky-700",
      tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
      tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    )}>{text}</div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <span className="theme-text-muted">{label}</span>
      <span className="font-mono text-xs theme-text-strong">{value}</span>
    </div>
  );
}

function ProcessCard({
  name,
  process,
  onRestart,
  disabled = true,
  pending = false,
}: {
  name: string;
  process: MonitoringOverview["processes"]["api"];
  onRestart?: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-800">{name}</div>
          <div className="mt-1 text-xs text-slate-500">
            pid: {process.pid ?? "n/a"} · uptime: {process.uptime_seconds != null ? `${process.uptime_seconds}s` : "n/a"} · estado: {process.status}
          </div>
        </div>
        {onRestart ? (
          <button onClick={onRestart} disabled={disabled} className="theme-button-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-50">
            {pending ? "Reiniciando…" : `Restart ${name}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
      <div className="font-medium text-slate-800">{title}</div>
      <div className="mt-2 space-y-2 text-slate-500">
        {items.length === 0 ? <div>Sin registros.</div> : items.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
