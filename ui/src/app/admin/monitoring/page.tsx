"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getMonitoringOverview,
  restartSystemProcess,
  type MonitoringOverview,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { AdminPageLayout, SectionCard, StatCard } from "@/components/admin-shell";

export default function MonitoringPage() {
  const token = useAuthStore((s) => s.token);
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [restartTarget, setRestartTarget] = useState<"core" | "api" | null>(null);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

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

  const statusTone = overview?.status === "degraded" ? "warn" : "good";

  return (
    <AdminPageLayout
      eyebrow="Monitoreo"
      title="Monitoreo"
      description="Vista ejecutiva única del sistema: procesos, pipeline, backups, costos, performance y errores recientes sobre un solo contrato backend."
      actions={
        <>
          {lastRefresh ? <span className="text-xs theme-text-muted">Actualizado {formatRelative(lastRefresh.toISOString())}</span> : null}
          <button onClick={() => void refresh()} className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">
            Refrescar
          </button>
          <Link href="/admin/backups" className="theme-button-secondary rounded-lg px-3 py-2 text-sm font-medium">
            Abrir backups
          </Link>
        </>
      }
    >
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
                    <InfoRow label="Máximo backups" value={String(overview.backups.config.max_backups)} />
                    <InfoRow label="Backups presentes" value={String(overview.backups.summary.backup_count)} />
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
    </AdminPageLayout>
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
