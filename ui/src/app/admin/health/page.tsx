"use client";

import { useEffect, useState, useCallback } from "react";
import { getHealth, type HealthStatus } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";

export default function HealthPage() {
  const token = useAuthStore((s) => s.token);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getHealth(token);
      setHealth(data);
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

      {health && (
        <>
          {/* DB + API status */}
          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Conectividad</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatusRow
                label="API"
                value="ok"
                ok
              />
              <StatusRow
                label="Base de datos"
                value={health.db}
                ok={health.db === "connected"}
              />
            </div>
          </div>

          {/* Cron / pipeline */}
          <div className="bg-white rounded-lg shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Pipeline cron</h2>
            <div className="space-y-2">
              <StatusRow
                label="Cron habilitado"
                value={health.cron.enabled ? "Sí" : "No"}
                ok={health.cron.enabled}
              />
              {health.cron.missed && (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
                  <span>⚠️</span>
                  <span>Run perdido — el cron debería haber corrido y no lo hizo</span>
                </div>
              )}
              <div className="text-sm text-gray-600 flex justify-between">
                <span>Próximo run</span>
                <span className="font-mono">{formatDate(health.cron.scheduled_for)}</span>
              </div>
              <div className="text-sm text-gray-600 flex justify-between">
                <span>Último completado</span>
                <span className="font-mono">{formatDate(health.cron.last_completed_at)}</span>
              </div>
            </div>
          </div>

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
