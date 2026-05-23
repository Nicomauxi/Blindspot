"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getCostsOverview,
  getSystemStatus,
  restartSystemProcess,
  type AdminSystemStatus,
  type BudgetStatus,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";

export default function HealthPage() {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<AdminSystemStatus | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [restartTarget, setRestartTarget] = useState<"core" | "api" | null>(null);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [systemRes, costsRes] = await Promise.all([
        getSystemStatus(token),
        getCostsOverview(token).catch(() => null),
      ]);
      setStatus(systemRes.data);
      setBudget(costsRes?.data.google_places ?? null);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar estado del sistema");
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

  function formatUptime(seconds: number | null) {
    if (seconds == null) return "n/a";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Estado del sistema</h1>
          <p className="mt-1 text-sm text-slate-500">Tablero técnico del backend: conectividad, cron, runs, discovery y alertas recientes.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh ? <span className="text-xs text-slate-500">Actualizado {formatRelative(lastRefresh.toISOString())}</span> : null}
          <button onClick={() => void refresh()} className="text-sm font-medium text-sky-700 hover:underline">Refrescar</button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {restartMessage ? <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">{restartMessage}</div> : null}

      {status ? (
        <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
          <Section title="Conectividad">
            <div className="grid gap-3 md:grid-cols-2">
              <StatusPill label="API" value={status.processes.api.status} ok={status.processes.api.running} />
              <StatusPill label="DB" value={status.db.connected ? "connected" : "error"} ok={status.db.connected} />
              <StatusPill label="IA" value={status.integrations.ai.provider_active} ok={status.integrations.ai.key_configured} />
              <StatusPill label="Webhook" value={status.integrations.webhook.configured ? "configurado" : "sin configurar"} ok={status.integrations.webhook.configured} />
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-600">
              <InfoRow label="Latencia DB" value={`${status.db.latency_ms.toFixed(1)} ms`} />
              <InfoRow label="Modelo IA" value={status.integrations.ai.model ?? "template / fallback"} />
              <InfoRow label="Eventos webhook" value={status.integrations.webhook.events.length > 0 ? status.integrations.webhook.events.join(", ") : "—"} />
            </div>
          </Section>

          <Section title="Pipeline">
            <div className="space-y-3">
              <StatusPill label="Cron" value={status.pipeline.cron_enabled ? "habilitado" : "deshabilitado"} ok={status.pipeline.cron_enabled} />
              <InfoRow label="Expresión" value={status.pipeline.cron_expression ?? "—"} />
              <InfoRow label="Próximo run" value={formatDate(status.pipeline.next_run_at)} />
              <InfoRow label="Último run" value={formatDate(status.pipeline.last_run_at)} />
              <InfoRow label="Run activo" value={status.pipeline.active_run ? `${status.pipeline.active_run.status} · ${status.pipeline.active_run.id.slice(0, 8)}…` : "ninguno"} />
              {status.pipeline.missed ? <Alert tone="warn" text="El cron debería haber corrido y no lo hizo dentro de la ventana esperada." /> : null}
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(status.pipeline.runs_recent).map(([key, summary]) => (
                  <div key={key} className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
                    <div className="font-medium text-slate-800">{key}</div>
                    <div className="mt-1 text-slate-500">{summary.total} runs · último {summary.last_status ?? "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Discovery">
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(status.discovery.summary).map(([key, count]) => (
                <div key={key} className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{count}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ListCard title="Últimos jobs manuales" items={status.discovery.recent_manual.map((job) => `${job.source} · ${job.location} · ${job.status}`)} />
              <ListCard title="Jobs fallidos" items={status.discovery.recent_failed.map((job) => `${job.source} · ${job.location} · ${job.error_message ?? job.status}`)} />
            </div>
            {budget?.over_alert ? <Alert tone="warn" text={`Presupuesto Google Places bajo: USD ${budget.budget_remaining.toFixed(2)} restantes.`} /> : null}
          </Section>

          <Section title="Procesos">
            <div className="space-y-3">
              <ProcessCard name="core" process={status.processes.core} onRestart={() => void handleRestart("core")} disabled={restartTarget !== null} pending={restartTarget === "core"} />
              <ProcessCard name="api" process={status.processes.api} onRestart={() => void handleRestart("api")} disabled={restartTarget !== null} pending={restartTarget === "api"} />
              <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                <div className="font-medium text-slate-800">db</div>
                <div className="mt-1">Estado: {status.processes.db.status}</div>
              </div>
            </div>
          </Section>

          <Section title="Alertas">
            <div className="space-y-3">
              {status.alerts.length === 0 ? <Alert tone="info" text="Sin alertas críticas activas en este momento." /> : status.alerts.map((alert) => <Alert key={alert} tone="warn" text={alert} />)}
              <ListCard title="Runs recientes" items={status.pipeline.recent.slice(0, 5).map((run) => `${run.status} · ${run.triggered_by} · ${formatRelative(run.created_at)}`)} />
              <ListCard title="Discovery reciente" items={status.discovery.recent.slice(0, 5).map((job) => `${job.source} · ${job.status} · ${formatRelative(job.created_at)}`)} />
            </div>
          </Section>
        </div>
      ) : (
        !error ? <div className="text-sm text-slate-500">Cargando…</div> : null
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

function StatusPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span>{label}</span>
      <span className="font-mono text-xs text-slate-700">{value}</span>
    </div>
  );
}

function Alert({ tone, text }: { tone: "warn" | "info"; text: string }) {
  return <div className={cn("rounded-xl px-3 py-3 text-sm", tone === "warn" ? "border border-amber-200 bg-amber-50 text-amber-800" : "border border-sky-200 bg-sky-50 text-sky-700")}>{text}</div>;
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
      <div className="font-medium text-slate-800">{title}</div>
      <div className="mt-2 space-y-2 text-slate-500">
        {items.length === 0 ? <div>Sin registros.</div> : items.map((item) => <div key={item}>{item}</div>)}
      </div>
    </div>
  );
}

function ProcessCard({ name, process, onRestart, disabled, pending }: { name: string; process: AdminSystemStatus["processes"]["api"]; onRestart: () => void; disabled: boolean; pending: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-800">{name}</div>
          <div className="mt-1 text-xs text-slate-500">pid: {process.pid ?? "n/a"} · uptime: {process.uptime_seconds != null ? `${process.uptime_seconds}s` : "n/a"} · estado: {process.status}</div>
        </div>
        <button onClick={onRestart} disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">{pending ? "Reiniciando…" : `Restart ${name}`}</button>
      </div>
    </div>
  );
}
