"use client";

import { useEffect, useState } from "react";
import { getCostsOverview, getCostsHistory, type CostsOverview, type CostsHistory } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate } from "@/lib/utils";

function BudgetBar({ spent, total, threshold }: { spent: number; total: number; threshold: number }) {
  const spentPct = Math.min((spent / total) * 100, 100);
  const thresholdPct = Math.min(((total - threshold) / total) * 100, 100);
  const overAlert = total - spent < threshold;

  return (
    <div className="relative h-4 bg-gray-100 rounded overflow-hidden">
      <div
        className={cn("h-full rounded transition-all", overAlert ? "bg-red-400" : "bg-green-400")}
        style={{ width: `${spentPct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-orange-400"
        style={{ left: `${thresholdPct}%` }}
        title={`Alert threshold: $${threshold}`}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

export default function CostsPage() {
  const token = useAuthStore((s) => s.token);
  const [overview, setOverview] = useState<CostsOverview | null>(null);
  const [history, setHistory] = useState<CostsHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([getCostsOverview(token), getCostsHistory(token)])
      .then(([ov, hist]) => {
        setOverview(ov.data);
        setHistory(hist.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar costos"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-3 text-sm">{error}</div>;

  const gp = overview?.google_places;

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Cost Dashboard</h1>

      <div className="grid grid-cols-2 gap-4">
        {/* Google Places budget */}
        <Section title="Google Places API">
          {gp ? (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Gastado: ${gp.budget_spent.toFixed(2)}</span>
                  <span>Total: ${gp.budget_total.toFixed(2)}</span>
                </div>
                <BudgetBar spent={gp.budget_spent} total={gp.budget_total} threshold={gp.alert_threshold} />
                <div className="flex justify-between text-xs">
                  <span className={cn("font-medium", gp.over_alert ? "text-red-600" : "text-green-700")}>
                    Restante: ${gp.budget_remaining.toFixed(2)}
                  </span>
                  <span className="text-gray-400">Alerta en: ${gp.alert_threshold.toFixed(2)}</span>
                </div>
              </div>
              {gp.over_alert && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-2 py-1.5">
                  Presupuesto por debajo del umbral de alerta
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Sin datos de presupuesto</p>
          )}
        </Section>

        {/* LLM usage */}
        <Section title="LLM (Fase 26+)">
          {overview?.llm ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Total llamadas</span>
                <span className="font-mono font-medium">{overview.llm.total_calls.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Costo total USD</span>
                <span className="font-mono font-medium">${overview.llm.total_cost_usd.toFixed(4)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin uso LLM registrado</p>
          )}
        </Section>
      </div>

      {/* LLM by month */}
      {history?.llm_by_month && history.llm_by_month.length > 0 && (
        <Section title="LLM por mes">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Mes</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Llamadas</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Tokens</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Costo USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.llm_by_month.map((row) => (
                  <tr key={row.month}>
                    <td className="px-3 py-1.5 font-mono">{row.month}</td>
                    <td className="px-3 py-1.5 text-right">{row.calls.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{row.tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">${row.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Google Places runs history */}
      {history?.google_places_runs && history.google_places_runs.length > 0 && (
        <Section title="Runs de Google Places">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Fecha</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Niche</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Ubicación</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Requests</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Costo USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.google_places_runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-1.5 text-xs text-gray-500">{formatDate(run.finished_at)}</td>
                    <td className="px-3 py-1.5">{run.niche}</td>
                    <td className="px-3 py-1.5 text-gray-600">{run.location}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{run.places_requests}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">${run.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {history?.google_places_runs?.length === 0 && history?.llm_by_month?.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">Sin historial de costos</p>
      )}
    </div>
  );
}
