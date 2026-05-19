"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPipelineConfig,
  patchPipelineConfig,
  triggerPipelineRun,
  abortPipelineRun,
  listPipelineRuns,
  testWebhook,
  type PipelineConfig,
  type PipelineRun,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";

type TestResult = { status: string; http_status?: number; url: string; error?: string } | null;

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  running: "bg-blue-50 text-blue-700 animate-pulse",
  completed: "bg-green-50 text-green-700",
  partial: "bg-orange-50 text-orange-700",
  failed: "bg-red-50 text-red-700",
  aborted: "bg-gray-50 text-gray-600",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-5 space-y-4">
      <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

export default function PipelineManagerPage() {
  const token = useAuthStore((s) => s.token);

  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config edit state
  const [enabled, setEnabled] = useState(false);
  const [cron, setCron] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  // Run controls
  const [triggering, setTriggering] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConfig = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await getPipelineConfig(token);
      setConfig(res.data);
      setEnabled(res.data.enabled);
      setCron(res.data.cron_expression ?? "");
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
    const [allRuns, runningRuns] = await Promise.all([
      listPipelineRuns(token, { limit: 10 }),
      listPipelineRuns(token, { status: "running", limit: 1 }),
    ]);
    setRuns(allRuns.data);
    setActiveRun(runningRuns.data[0] ?? null);
  }, [token]);

  useEffect(() => {
    void loadConfig();
    void loadRuns();
  }, [loadConfig, loadRuns]);

  // Poll for active run updates
  useEffect(() => {
    if (activeRun) {
      pollRef.current = setInterval(() => void loadRuns(), 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRun, loadRuns]);

  async function handleSaveConfig() {
    if (!token) return;
    setSaving(true);
    setSaveOk(false);
    try {
      const res = await patchPipelineConfig(token, {
        enabled,
        cron_expression: cron.trim() || undefined,
        notify_webhook_url: webhookUrl.trim() || null,
        notify_webhook_secret: webhookSecret.trim() || null,
        notify_webhook_events: webhookEvents as ("run_completed" | "new_hot_leads")[],
      });
      setConfig(res.data);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleTrigger() {
    if (!token) return;
    setTriggering(true);
    setError(null);
    try {
      await triggerPipelineRun(token, dryRun);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al disparar run");
    } finally {
      setTriggering(false);
    }
  }

  async function handleAbort() {
    if (!token) return;
    setAborting(true);
    try {
      await abortPipelineRun(token);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al abortar run");
    } finally {
      setAborting(false);
    }
  }

  async function handleTest() {
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
    setWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  if (loading && !config) {
    return <div className="text-gray-400 text-sm">Cargando pipeline…</div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Pipeline Manager</h1>

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 text-sm">{error}</div>
      )}

      {/* Active run monitor */}
      {activeRun && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">Run activo</p>
            <p className="text-xs text-blue-600 font-mono">{activeRun.id.slice(0, 8)}… · iniciado {formatRelative(activeRun.started_at)}</p>
          </div>
          <button
            onClick={handleAbort}
            disabled={aborting}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {aborting ? "Abortando…" : "Abortar"}
          </button>
        </div>
      )}

      {/* Config */}
      <Section title="Configuración">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm">Pipeline habilitado (cron automático)</span>
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Expresión cron <span className="text-gray-400">(ej. 0 3 * * *)</span></label>
          <input
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 3 * * *"
            className="text-sm border rounded px-3 py-1.5 font-mono w-48"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
          {saveOk && <span className="text-green-600 text-sm">Guardado</span>}
        </div>
        {config && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 border-t pt-3">
            <dt>Próxima ejecución</dt>
            <dd>{config.scheduled_for ? formatDate(config.scheduled_for) : "—"}</dd>
            <dt>Última completada</dt>
            <dd>{config.last_completed_at ? formatDate(config.last_completed_at) : "—"}</dd>
          </dl>
        )}
      </Section>

      {/* Manual run trigger */}
      <Section title="Ejecución manual">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="rounded border-gray-300"
            />
            Dry-run (no persiste cambios)
          </label>
          <button
            onClick={handleTrigger}
            disabled={triggering || !!activeRun}
            className={cn(
              "px-4 py-2 text-sm rounded font-medium disabled:opacity-50",
              dryRun
                ? "border border-gray-300 hover:bg-gray-50"
                : "bg-brand-600 text-white hover:bg-brand-700"
            )}
          >
            {triggering ? "Iniciando…" : dryRun ? "Dry-run ahora" : "Ejecutar ahora"}
          </button>
          {activeRun && (
            <span className="text-xs text-gray-500">Esperar a que termine el run activo</span>
          )}
        </div>
      </Section>

      {/* Run history */}
      <Section title="Historial de runs">
        {runs.length === 0 ? (
          <p className="text-sm text-gray-400">Sin runs registrados</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center gap-3 text-sm border-b pb-2 last:border-0">
                <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium shrink-0", RUN_STATUS_COLORS[run.status] ?? "bg-gray-50")}>
                  {run.status}
                </span>
                <span className="font-mono text-xs text-gray-500 shrink-0">{run.id.slice(0, 8)}…</span>
                {run.overrides?.dry_run && <span className="text-xs bg-yellow-50 text-yellow-600 px-1 rounded">dry-run</span>}
                <span className="text-xs text-gray-400 shrink-0">
                  {run.overrides?.phases?.length ? run.overrides.phases.join(", ") : run.triggered_by}
                </span>
                {run.dashboard_stale && (
                  <span className="text-xs bg-orange-50 text-orange-700 px-1 rounded">dashboard stale</span>
                )}
                <span className="flex-1" />
                <span className="text-xs text-gray-400 shrink-0">{formatRelative(run.created_at)}</span>
                {run.completed_at && run.started_at && (
                  <span className="text-xs text-gray-400 shrink-0">
                    {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <button onClick={loadRuns} className="text-xs text-brand-600 hover:underline mt-1">
          Actualizar
        </button>
      </Section>

      {/* Webhook config */}
      <Section title="Webhook de notificaciones">
        <p className="text-xs text-gray-500">Recibe notificaciones HMAC-SHA256 en Slack, n8n, Make u otros servicios.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">URL del webhook</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className="text-sm border rounded px-3 py-1.5 w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Secreto HMAC</label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              autoComplete="new-password"
              className="text-sm border rounded px-3 py-1.5 font-mono w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Eventos</label>
            <div className="flex gap-4">
              {(["run_completed", "new_hot_leads"] as const).map((evt) => (
                <label key={evt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(evt)}
                    onChange={() => toggleEvent(evt)}
                    className="rounded border-gray-300"
                  />
                  <span className="font-mono text-xs">{evt}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          {webhookUrl.trim() && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 border text-sm rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? "Enviando…" : "Probar webhook"}
            </button>
          )}
        </div>
        {testResult && (
          <div className={`rounded px-3 py-2 text-sm ${testResult.status === "sent" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testResult.status === "sent"
              ? `Enviado correctamente (HTTP ${testResult.http_status})`
              : `Error: ${testResult.error ?? `HTTP ${testResult.http_status ?? "?"}`}`}
          </div>
        )}
      </Section>
    </div>
  );
}
