"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abortPipelineRun,
  getPipelineConfig,
  getPipelineRun,
  getPipelineRunLog,
  listPipelineRuns,
  patchPipelineConfig,
  testWebhook,
  triggerPipelineRun,
  type PipelineConfig,
  type PipelineLogLine,
  type PipelineRun,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";

type TestResult = { status: string; http_status?: number; url: string; error?: string } | null;

const RUN_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-50 text-yellow-700",
  pending: "bg-yellow-50 text-yellow-700",
  running: "bg-blue-50 text-blue-700 animate-pulse",
  completed: "bg-green-50 text-green-700",
  partial: "bg-orange-50 text-orange-700",
  failed: "bg-red-50 text-red-700",
  aborted: "bg-gray-50 text-gray-600",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-700">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function parseDailyHour(cron: string | null): string {
  if (!cron) return "03:00";
  const match = cron.trim().match(/^0\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) return "03:00";
  return `${match[1].padStart(2, "0")}:00`;
}

function isSimpleDailyCron(cron: string | null): boolean {
  return Boolean(cron && /^0\s+\d{1,2}\s+\*\s+\*\s+\*$/.test(cron.trim()));
}

function normalizeStatus(status: PipelineRun["status"] | "queued") {
  return status === "pending" ? "queued" : status;
}

function describeRun(run: PipelineRun | null) {
  if (!run) return "Sin ejecución activa";
  return run.overrides?.dry_run ? "Dry-run manual" : run.triggered_by === "manual" ? "Run manual completo" : `Run ${run.triggered_by}`;
}

export default function PipelineManagerPage() {
  const token = useAuthStore((s) => s.token);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
  const [runLogs, setRunLogs] = useState<PipelineLogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [scheduledHour, setScheduledHour] = useState("03:00");
  const [advancedCronWarning, setAdvancedCronWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [triggeringMode, setTriggeringMode] = useState<"full" | "dry" | null>(null);
  const [aborting, setAborting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeRun = useMemo(() => runs.find((run) => run.status === "running" || run.status === "pending") ?? null, [runs]);
  const selectedRunId = selectedRun?.id ?? activeRun?.id ?? null;

  const loadConfig = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await getPipelineConfig(token);
      setConfig(res.data);
      setEnabled(res.data.enabled);
      setScheduledHour(parseDailyHour(res.data.cron_expression));
      setAdvancedCronWarning(!isSimpleDailyCron(res.data.cron_expression));
      setWebhookUrl(res.data.notify_webhook_url ?? "");
      setWebhookSecret(res.data.notify_webhook_secret ?? "");
      setWebhookEvents(res.data.notify_webhook_events ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadRuns = useCallback(async () => {
    if (!token) return;
    try {
      const res = await listPipelineRuns(token, { limit: 10 });
      setRuns(res.data);
      setSelectedRun((current) => current ? res.data.find((run) => run.id === current.id) ?? current : res.data[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar runs");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar detalle del run");
    }
  }, [token]);

  useEffect(() => {
    void loadConfig();
    void loadRuns();
  }, [loadConfig, loadRuns]);

  useEffect(() => {
    if (!selectedRunId) return;
    void loadRunDetail(selectedRunId);
  }, [loadRunDetail, selectedRunId]);

  useEffect(() => {
    if (!(activeRun?.id ?? selectedRunId)) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(() => {
      void loadRuns();
      if (selectedRunId) void loadRunDetail(selectedRunId);
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRun?.id, loadRunDetail, loadRuns, selectedRunId]);

  async function handleSaveConfig() {
    if (!token) return;
    setSaving(true);
    setSaveOk(false);
    setError(null);
    try {
      const cronExpression = `0 ${scheduledHour.slice(0, 2)} * * *`;
      const res = await patchPipelineConfig(token, {
        enabled,
        cron_expression: cronExpression,
        notify_webhook_url: webhookUrl.trim() || null,
        notify_webhook_secret: webhookSecret.trim() || null,
        notify_webhook_events: webhookEvents as ("run_completed" | "new_hot_leads")[],
      });
      setConfig(res.data);
      setScheduledHour(parseDailyHour(res.data.cron_expression));
      setAdvancedCronWarning(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar configuración");
    } finally {
      setSaving(false);
    }
  }

  async function handleTrigger(dryRun: boolean) {
    if (!token) return;
    setTriggeringMode(dryRun ? "dry" : "full");
    setError(null);
    try {
      const res = await triggerPipelineRun(token, dryRun);
      await loadRuns();
      await loadRunDetail(res.data.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar el run");
    } finally {
      setTriggeringMode(null);
    }
  }

  async function handleAbort() {
    if (!token || !activeRun) return;
    setAborting(true);
    try {
      await abortPipelineRun(token);
      await loadRuns();
      await loadRunDetail(activeRun.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al abortar el run");
    } finally {
      setAborting(false);
    }
  }

  async function handleTestWebhook() {
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testWebhook(token);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ status: "failed", url: webhookUrl, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  function toggleEvent(event: string) {
    setWebhookEvents((prev) => prev.includes(event) ? prev.filter((entry) => entry !== event) : [...prev, event]);
  }

  const phaseEntries = selectedRun?.phase_results ? Object.entries(selectedRun.phase_results) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Pipeline Manager</h1>
        <p className="mt-1 text-sm text-slate-500">Configura la corrida diaria, dispara runs manuales y seguí el estado real de la última ejecución lanzada.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      {activeRun ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-900">Run activo</p>
              <p className="mt-1 text-xs text-blue-700">{describeRun(activeRun)} · {formatRelative(activeRun.started_at ?? activeRun.created_at)}</p>
            </div>
            <button onClick={handleAbort} disabled={aborting} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {aborting ? "Abortando…" : "Abortar run"}
            </button>
          </div>
        </div>
      ) : null}

      <Section title="Configuración" description="La agenda se simplifica a una hora fija diaria. Al guardar, siempre se normaliza a cron diario `0 HH * * *`.">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="rounded border-slate-300" />
            Pipeline habilitado
          </label>

          <div className="grid gap-4 md:grid-cols-[220px,1fr] md:items-end">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Hora diaria</label>
              <input type="time" step={3600} value={scheduledHour} onChange={(event) => setScheduledHour(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Corre todos los días a las <span className="font-semibold text-slate-900">{scheduledHour}</span> (hora del servidor).
              {advancedCronWarning ? <div className="mt-2 text-amber-700">El cron actual era avanzado. Al guardar se normaliza al formato diario simple.</div> : null}
            </div>
          </div>

          {config ? (
            <dl className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Próxima ejecución</dt>
                <dd className="mt-1">{config.scheduled_for ? formatDate(config.scheduled_for) : "—"}</dd>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Última completada</dt>
                <dd className="mt-1">{config.last_completed_at ? formatDate(config.last_completed_at) : "—"}</dd>
              </div>
            </dl>
          ) : null}

          <div className="flex items-center gap-3">
            <button onClick={handleSaveConfig} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar configuración"}
            </button>
            {saveOk ? <span className="text-sm text-emerald-700">Guardado</span> : null}
          </div>
        </div>
      </Section>

      <Section title="Ejecución manual" description="El run completo dispara discovery, enriquecimiento, scoring y refresh operativo. El dry-run ejecuta las mismas fases sin persistir cambios.">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button onClick={() => void handleTrigger(false)} disabled={triggeringMode !== null || !!activeRun} className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-left transition-colors hover:bg-sky-100 disabled:opacity-50">
              <div className="text-sm font-semibold text-sky-900">Run completo</div>
              <p className="mt-1 text-sm text-sky-700">Persiste cambios, actualiza resultados y deja el dashboard operativo.</p>
            </button>
            <button onClick={() => void handleTrigger(true)} disabled={triggeringMode !== null || !!activeRun} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:bg-slate-50 disabled:opacity-50">
              <div className="text-sm font-semibold text-slate-900">Dry-run</div>
              <p className="mt-1 text-sm text-slate-600">Corre todas las fases pero sin escribir cambios persistentes.</p>
            </button>
          </div>
          {triggeringMode ? <div className="text-sm text-slate-500">Iniciando {triggeringMode === "dry" ? "dry-run" : "run completo"}…</div> : null}
        </div>
      </Section>

      <Section title="Estado del run" description="Seguimiento en vivo del último run lanzado o seleccionado, incluyendo fases y log incremental.">
        {!selectedRun ? (
          <p className="text-sm text-slate-500">Todavía no hay un run para inspeccionar.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", RUN_STATUS_COLORS[normalizeStatus(selectedRun.status)] ?? "bg-slate-100 text-slate-700")}>{normalizeStatus(selectedRun.status)}</span>
              <span className="font-mono text-xs text-slate-500">{selectedRun.id}</span>
              {selectedRun.overrides?.dry_run ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">dry-run</span> : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard label="Creado" value={formatRelative(selectedRun.created_at)} />
              <MetricCard label="Inicio" value={selectedRun.started_at ? formatRelative(selectedRun.started_at) : "En cola"} />
              <MetricCard label="Fin" value={selectedRun.completed_at ? formatRelative(selectedRun.completed_at) : "—"} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fases</div>
                {phaseEntries.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay `phase_results` reportados.</p> : (
                  <div className="space-y-3">
                    {phaseEntries.map(([phase, result]) => (
                      <div key={phase} className="rounded-xl bg-slate-50 p-3">
                        <div className="text-sm font-semibold text-slate-900">{phase}</div>
                        <pre className="mt-2 overflow-auto text-xs text-slate-600">{JSON.stringify(result, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Log incremental</div>
                <div className="max-h-80 space-y-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-200">
                  {runLogs.length === 0 ? <div className="text-slate-500">Sin líneas registradas todavía.</div> : runLogs.map((line, index) => (
                    <div key={`${line.ts ?? "line"}-${index}`}>
                      <span className="text-slate-500">[{line.ts ? new Date(line.ts).toLocaleTimeString("es-UY") : "--:--:--"}]</span>{" "}
                      <span className="text-sky-300">{line.level ?? "info"}</span>{" "}
                      <span>{line.msg ?? JSON.stringify(line)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Historial de runs" description="Últimas ejecuciones para saltar entre runs recientes y comparar resultado completo vs dry-run.">
        {runs.length === 0 ? <p className="text-sm text-slate-500">Sin runs registrados.</p> : (
          <div className="space-y-2">
            {runs.map((run) => (
              <button key={run.id} onClick={() => void loadRunDetail(run.id)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors", selectedRun?.id === run.id ? "border-sky-200 bg-sky-50" : "border-slate-200 hover:bg-slate-50")}>
                <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", RUN_STATUS_COLORS[normalizeStatus(run.status)] ?? "bg-slate-100 text-slate-700")}>{normalizeStatus(run.status)}</span>
                <span className="font-mono text-xs text-slate-500">{run.id.slice(0, 8)}…</span>
                <span className="text-xs text-slate-500">{run.overrides?.dry_run ? "dry-run" : run.triggered_by}</span>
                <span className="ml-auto text-xs text-slate-400">{formatRelative(run.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Webhook de notificaciones" description="Configuración aparte del control de runs para no mezclar agenda, ejecución y entrega de eventos.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">URL del webhook</label>
            <input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" placeholder="https://hooks.slack.com/services/..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Secreto HMAC</label>
            <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" autoComplete="new-password" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Eventos</label>
            <div className="flex flex-wrap gap-3">
              {(["run_completed", "new_hot_leads"] as const).map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={webhookEvents.includes(event)} onChange={() => toggleEvent(event)} className="rounded border-slate-300" />
                  {event}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSaveConfig} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar webhook"}
            </button>
            {webhookUrl.trim() ? <button onClick={handleTestWebhook} disabled={testing} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">{testing ? "Enviando…" : "Probar webhook"}</button> : null}
          </div>
          {testResult ? <div className={cn("rounded-xl px-3 py-2 text-sm", testResult.status === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{testResult.status === "sent" ? `Enviado correctamente (HTTP ${testResult.http_status})` : `Error: ${testResult.error ?? `HTTP ${testResult.http_status ?? "?"}`}`}</div> : null}
        </div>
      </Section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800">{value}</div>
    </div>
  );
}
