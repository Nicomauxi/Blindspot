"use client";

import { useEffect, useState } from "react";
import { getCostsOverview, getCostsHistory, type CostsOverview, type CostsHistory } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

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

function Money({ value }: { value: number | null | undefined }) {
  return <span className="font-mono">${(value ?? 0).toFixed(2)}</span>;
}

function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-UY", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
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

function SourceBars({ items }: { items: CostsOverview["per_source"] }) {
  const maxCost = items.reduce((max, item) => Math.max(max, item.cost_usd), 0) || 1;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.source} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-medium text-gray-800">{item.source}</span>
              <span className="ml-2 text-xs text-gray-500">{item.leads_count} leads</span>
            </div>
            <Money value={item.cost_usd} />
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                item.source === "infra" || item.source === "backup" ? "bg-slate-400" : "bg-emerald-500"
              )}
              style={{ width: `${Math.max((item.cost_usd / maxCost) * 100, item.cost_usd > 0 ? 6 : 0)}%` }}
            />
          </div>
        </div>
      ))}
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
  const monthLabel = overview ? formatMonth(overview.month) : "";
  const monthlyTrend = history?.monthly ?? [];
  const trendMax = monthlyTrend.reduce((max, row) => Math.max(max, row.total_usd), 0) || 1;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-gray-900">Cost Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen estimado de costos para {monthLabel}.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total del mes</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            <Money value={overview?.totals.total_usd} />
          </p>
          <p className="mt-1 text-xs text-gray-500">LLM + Google Places + infraestructura + backup</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Costo variable</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            <Money value={overview?.per_lead.total_cost_usd} />
          </p>
          <p className="mt-1 text-xs text-gray-500">Gasto directo sobre leads y automatizaciones</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Hot leads del mes</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{overview?.per_lead.hot_leads_count ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">Umbral canónico `prospect_score &gt;= 55`</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Costo por hot lead</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            <Money value={overview?.per_lead.cost_per_hot_usd} />
          </p>
          <p className="mt-1 text-xs text-gray-500">Costo variable dividido por leads hot del mes</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
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
                  <span className="text-gray-400">Alerta en: ${gp.alert_threshold.toFixed(2)} · {gp.request_count} requests</span>
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

        <Section title="Desglose actual">
          {overview ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">LLM</span>
                <Money value={overview.totals.llm_usd} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Google Places</span>
                <Money value={overview.totals.google_places_usd} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Infra</span>
                <Money value={overview.totals.infra_usd} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Backup</span>
                <Money value={overview.totals.backup_usd} />
              </div>
              <div className="border-t pt-2 flex justify-between font-medium">
                <span className="text-gray-700">Total</span>
                <Money value={overview.totals.total_usd} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin datos disponibles</p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        <Section title="Costo por fuente">
          <SourceBars items={overview?.per_source ?? []} />
        </Section>

        <Section title="LLM por proveedor">
          <div className="space-y-3">
            {overview?.llm.by_provider.length ? (
              overview.llm.by_provider.map((provider) => (
                <div key={provider.provider} className="border rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">{provider.provider}</span>
                    <Money value={provider.cost_usd} />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {provider.calls} llamadas · {provider.tokens.toLocaleString()} tokens · {provider.leads_count} leads
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">Sin uso LLM registrado en el mes</p>
            )}
          </div>
        </Section>
      </div>

      <Section title="Top leads por costo">
        {overview?.per_lead.top_leads.length ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Lead</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Fuente</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">LLM</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Share GP</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overview.per_lead.top_leads.map((lead) => (
                  <tr key={lead.lead_id}>
                    <td className="px-3 py-1.5 font-medium text-gray-800">{lead.name}</td>
                    <td className="px-3 py-1.5 text-gray-600">{lead.source ?? "n/a"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">${lead.llm_cost_usd.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">${lead.gp_cost_share_usd.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-medium">${lead.total_cost_usd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Todavía no hay costo distribuible por lead en este mes.</p>
        )}
      </Section>

      <Section title="Historial 12 meses">
        {monthlyTrend.length ? (
          <div className="space-y-4">
            <div className="grid gap-2">
              {monthlyTrend.map((row) => (
                <div key={row.month} className="grid grid-cols-[90px,1fr,120px] items-center gap-3 text-sm">
                  <span className="font-mono text-gray-500">{row.month}</span>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${Math.max((row.total_usd / trendMax) * 100, row.total_usd > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-gray-800">${row.total_usd.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Mes</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">GP</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">LLM</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Infra</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Backup</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Hot</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthlyTrend.map((row) => (
                    <tr key={row.month}>
                      <td className="px-3 py-1.5 font-mono">{row.month}</td>
                      <td className="px-3 py-1.5 text-right font-mono">${row.google_places_usd.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">${row.llm_usd.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">${row.infra_usd.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">${row.backup_usd.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right">{row.hot_leads}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium">${row.total_usd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">Sin historial de costos</p>
        )}
      </Section>
    </div>
  );
}
