"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPipelineConfig,
  patchPipelineConfig,
  testWebhook,
  type PipelineConfig,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatDate } from "@/lib/utils";

type TestResult = { status: string; http_status?: number; url: string; error?: string } | null;

export default function PipelineManagerPage() {
  const token = useAuthStore((s) => s.token);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await getPipelineConfig(token);
      setConfig(res.data);
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

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setSaveOk(false);
    try {
      const res = await patchPipelineConfig(token, {
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

  async function handleTest() {
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testWebhook(token);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({
        status: "failed",
        url: webhookUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  function toggleEvent(event: string) {
    setWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <div className="text-gray-400 text-sm">Cargando configuración…</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Pipeline Manager</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 text-sm">{error}</div>
      )}

      {config && (
        <div className="bg-white rounded-lg shadow-sm border p-5 space-y-3">
          <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">
            Estado del pipeline
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">Habilitado</dt>
            <dd>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                {config.enabled ? "Sí" : "No"}
              </span>
            </dd>
            <dt className="text-gray-500">Cron</dt>
            <dd className="font-mono text-xs">{config.cron_expression ?? "—"}</dd>
            <dt className="text-gray-500">Próxima ejecución</dt>
            <dd className="text-xs">{config.scheduled_for ? formatDate(config.scheduled_for) : "—"}</dd>
            <dt className="text-gray-500">Última completada</dt>
            <dd className="text-xs">{config.last_completed_at ? formatDate(config.last_completed_at) : "—"}</dd>
          </dl>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">
          Webhook de notificaciones
        </h2>
        <p className="text-xs text-gray-500">
          Recibe notificaciones HMAC-SHA256 en Slack, n8n, Make u otros servicios.
        </p>

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">URL del webhook</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className="text-sm border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">
              Secreto HMAC <span className="font-normal text-gray-400">(mínimo 8 caracteres)</span>
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="new-password"
              className="text-sm border border-gray-300 rounded px-3 py-2 font-mono"
            />
            <p className="text-xs text-gray-400">
              La firma se envía en el header{" "}
              <code className="bg-gray-100 px-1 rounded">X-Blindspot-Signature: sha256=…</code>
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">Eventos a notificar</label>
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

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white text-sm rounded font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar configuración"}
          </button>
          {webhookUrl.trim() && (
            <button
              onClick={() => void handleTest()}
              disabled={testing || saving}
              className="px-4 py-2 border border-gray-300 text-sm rounded font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? "Enviando…" : "Probar webhook"}
            </button>
          )}
          {saveOk && (
            <span className="text-green-600 text-sm font-medium">Guardado</span>
          )}
        </div>

        {testResult && (
          <div className={`rounded px-3 py-2 text-sm ${testResult.status === "sent" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testResult.status === "sent" ? (
              <>Webhook enviado correctamente (HTTP {testResult.http_status})</>
            ) : (
              <>Error: {testResult.error ?? `HTTP ${testResult.http_status ?? "?"}`}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
