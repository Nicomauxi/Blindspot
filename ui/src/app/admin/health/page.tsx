"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [health, setHealth] = useState<AdminSystemStatus | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [restartTarget, setRestartTarget] = useState<"core" | "api" | null>(null);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [data, costs] = await Promise.all([getSystemStatus(token), getCostsOverview(token).catch(() => null)]);
      setHealth(data.data);
      setBudget(costs?.data.google_places ?? null);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar estado");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleRestart = useCallback(async (target: "core" | "api") => {
    if (!token) return;
    const confirmed = window.confirm(`Esto reinicia el proceso ${target}. ¿Continuar?`);
    if (!confirmed) return;

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
    if (seconds === null) return "n/a";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    if (minutes < 60) return `${minutes}m ${rem}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Estado del sistema</h1>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-500">
              Actualizado {formatRelative(lastRefresh.toISOString())}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            Refrescar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 text-sm">{error}</div>
      )}

      {restartMessage && (
        <div className="bg-sky-50 text-sky-700 rounded px-4 py-3 text-sm">{restartMessage}</div>
      )}

      {health && (
        <>
          {/* DB + API status */}
          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Conectividad</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatusRow
                label="API"
                value={health.processes.api.status}
                ok={health.processes.api.running}
              />
              <StatusRow
                label="Base de datos"
                value={health.db.connected ? "connected" : "error"}
                ok={health.db.connected}
              />
            </div>
            <div className="mt-3 text-sm text-gray-600 flex justify-between">
              <span>Latencia DB</span>
              <span className="font-mono">{health.db.latency_ms.toFixed(1)} ms</span>
            </div>
            <div className="mt-2 text-sm text-gray-600 flex justify-between">
              <span>Uptime API</span>
              <span className="font-mono">{formatUptime(health.processes.api.uptime_seconds)}</span>
            </div>
          </div>

          {/* Cron / pipeline */}
          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Pipeline cron</h2>
            <div className="space-y-2">
              <StatusRow
                label="Cron habilitado"
                value={health.pipeline.cron_enabled ? "Sí" : "No"}
                ok={health.pipeline.cron_enabled}
              />
              {health.pipeline.missed && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
                  <span>⚠️</span>
                  <span>Run perdido — el cron debería haber corrido y no lo hizo</span>
                </div>
              )}
              <div className="text-sm text-gray-600 flex justify-between">
                <span>Próximo run</span>
                <span className="font-mono">{formatDate(health.pipeline.next_run_at)}</span>
              </div>
              <div className="text-sm text-gray-600 flex justify-between">
                <span>Último completado</span>
                <span className="font-mono">{formatDate(health.pipeline.last_run_at)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Procesos</h2>
            <div className="space-y-3">
              <div className="border rounded-lg px-3 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-800">core</div>
                    <div className="text-xs text-gray-500">
                      pid: {health.processes.core.pid ?? "n/a"} · uptime: {formatUptime(health.processes.core.uptime_seconds)}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestart("core")}
                    disabled={restartTarget !== null}
                    className="text-sm rounded border px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {restartTarget === "core" ? "Reiniciando..." : "Restart Core"}
                  </button>
                </div>
              </div>
              <div className="border rounded-lg px-3 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-800">api</div>
                    <div className="text-xs text-gray-500">
                      pid: {health.processes.api.pid ?? "n/a"} · uptime: {formatUptime(health.processes.api.uptime_seconds)}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRestart("api")}
                    disabled={restartTarget !== null}
                    className="text-sm rounded border px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {restartTarget === "api" ? "Reiniciando..." : "Restart API"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Google Places budget badge */}
          {budget && budget.over_alert && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm flex items-center gap-2">
              <span>Presupuesto Google Places bajo:</span>
              <span className="font-semibold">${budget.budget_remaining.toFixed(2)} restantes</span>
              <span className="text-red-400">(umbral: ${budget.alert_threshold.toFixed(2)})</span>
            </div>
          )}

          {/* Last run */}
          {health.last_run && (
            <div className="bg-white rounded-lg shadow-sm border p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Último pipeline run</h2>
              <div className="space-y-2">
                <StatusRow
                  label="Estado"
                  value={health.last_run.status}
                  ok={health.last_run.status === "completed"}
                />
                <div className="text-sm text-gray-600 flex justify-between">
                  <span>Completado</span>
                  <span className="font-mono">{formatDate(health.last_run.completed_at)}</span>
                </div>
                {health.last_run.dashboard_stale && (
                  <div className="text-sm text-amber-600">
                  ⚠️ Dashboard puede estar desactualizado (run interrumpido)
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!health && !error && (
        <div className="text-sm text-gray-500">Cargando…</div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span
        className={cn(
          "font-medium px-2 py-0.5 rounded-full text-xs",
          ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        )}
      >
        {value}
      </span>
    </div>
  );
}
