"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getGpBudget,
  getPipelineConfig,
  patchPipelineConfig,
  resetGpBudgetSpent,
  testWebhook,
  triggerPipelineRun,
  updateGpBudget,
  updateMaxJobs,
  type GpBudgetStatus,
  type PipelineConfig,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate } from "@/lib/utils";

type TestResult = { status: string; http_status?: number; url: string; error?: string } | null;

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

export function PipelineSection() {
  const token = useAuthStore((s) => s.token);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
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
  const [budget, setBudget] = useState<GpBudgetStatus | null>(null);
  const [budgetTotal, setBudgetTotal] = useState("");
  const [budgetThreshold, setBudgetThreshold] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetOk, setBudgetOk] = useState(false);
  const [maxJobs, setMaxJobs] = useState<number | null>(null);
  const [maxJobsInput, setMaxJobsInput] = useState("");
  const [savingMaxJobs, setSavingMaxJobs] = useState(false);
  const [maxJobsOk, setMaxJobsOk] = useState(false);

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
      const currentMaxJobs = (res.data.phases?.["discovery"] as { max_jobs?: number } | undefined)?.max_jobs ?? null;
      setMaxJobs(currentMaxJobs);
      setMaxJobsInput(currentMaxJobs !== null ? String(currentMaxJobs) : "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadBudget = useCallback(async () => {
    if (!token) return;
    try {
      const res = await getGpBudget(token);
      setBudget(res.data);
      setBudgetTotal(String(res.data.budget_total));
      setBudgetThreshold(String(res.data.alert_threshold));
    } catch {
      // non-blocking
    }
  }, [token]);

  useEffect(() => {
    void loadConfig();
    void loadBudget();
  }, [loadConfig, loadBudget]);

  async function handleSaveBudget() {
    if (!token) return;
    const total = parseFloat(budgetTotal);
    const threshold = parseFloat(budgetThreshold);
    if (isNaN(total) || total <= 0) {
      setError("Budget total debe ser un número positivo");
      return;
    }
    setSavingBudget(true);
    try {
      const res = await updateGpBudget(token, { budget_total: total, alert_threshold: isNaN(threshold) ? undefined : threshold });
      setBudget(res.data);
      setBudgetOk(true);
      setTimeout(() => setBudgetOk(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar budget");
    } finally {
      setSavingBudget(false);
    }
  }

  async function handleResetBudgetSpent() {
    if (!token) return;
    if (!window.confirm("¿Resetear el gasto de Google Places a 0?")) return;
    try {
      const res = await resetGpBudgetSpent(token);
      setBudget(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al resetear gasto");
    }
  }

  async function handleSaveMaxJobs() {
    if (!token) return;
    const value = parseInt(maxJobsInput, 10);
    if (isNaN(value) || value < 1 || value > 50) {
      setError("max_jobs debe ser un número entre 1 y 50");
      return;
    }
    setSavingMaxJobs(true);
    try {
      await updateMaxJobs(token, value);
      setMaxJobs(value);
      setMaxJobsOk(true);
      setTimeout(() => setMaxJobsOk(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar max_jobs");
    } finally {
      setSavingMaxJobs(false);
    }
  }

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

  async function handleTrigger() {
    if (!token) return;
    setTriggeringMode("full");
    setError(null);
    try {
      await triggerPipelineRun(token, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar el run");
    } finally {
      setTriggeringMode(null);
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

  if (loading && !config) return <div className="text-sm theme-text-muted">Cargando pipeline…</div>;

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

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

      <Section title="Ejecución manual" description="Dispara el pipeline completo ahora: refresh, discovery, enriquecimiento y scoring sobre todos los leads activos.">
        <div className="space-y-4">
          <button onClick={() => void handleTrigger()} disabled={triggeringMode !== null} className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-left transition-colors hover:bg-sky-100 disabled:opacity-50">
            <div className="text-sm font-semibold text-sky-900">Run completo</div>
            <p className="mt-1 text-sm text-sky-700">Persiste cambios, actualiza resultados y deja el dashboard operativo.</p>
          </button>
          {triggeringMode ? <div className="text-sm text-slate-500">Iniciando run completo…</div> : null}
        </div>
      </Section>

      {budget !== null ? (
        <Section title="Budget Google Places" description="Presupuesto mensual para discovery con Google Places API.">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total mensual</div>
                <div className="mt-1 text-sm text-slate-800">USD {budget.budget_total.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gastado</div>
                <div className={cn("mt-1 text-sm", budget.over_alert ? "text-amber-700 font-semibold" : "text-slate-800")}>USD {budget.budget_spent.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Restante</div>
                <div className="mt-1 text-sm text-slate-800">USD {budget.budget_remaining.toFixed(2)}</div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 md:items-end">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Total mensual (USD)</label>
                <input type="number" min="0.01" step="1" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Umbral de alerta (USD)</label>
                <input type="number" min="0" step="1" value={budgetThreshold} onChange={(e) => setBudgetThreshold(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => void handleSaveBudget()} disabled={savingBudget} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {savingBudget ? "Guardando…" : "Guardar budget"}
              </button>
              <button onClick={() => void handleResetBudgetSpent()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Resetear gasto del mes
              </button>
              {budgetOk ? <span className="text-sm text-emerald-700">Guardado</span> : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Configuración de jobs" description="Máximo de discovery jobs procesados en cada ciclo del pipeline.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Max jobs por ciclo
              {maxJobs !== null ? <span className="ml-2 font-normal text-slate-400">Actual: {maxJobs}</span> : null}
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={maxJobsInput}
              onChange={(e) => setMaxJobsInput(e.target.value)}
              className="w-48 rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              placeholder="ej: 5"
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void handleSaveMaxJobs()} disabled={savingMaxJobs} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {savingMaxJobs ? "Guardando…" : "Guardar"}
            </button>
            {maxJobsOk ? <span className="text-sm text-emerald-700">Guardado</span> : null}
          </div>
        </div>
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
