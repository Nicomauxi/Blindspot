"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AdminPageLayout, EmptyPanel, HelpTip, SectionCard, StatCard } from "@/components/admin-shell";
import { listOutreach, listCampaigns, patchOutreach, type OutreachEntry, type Campaign } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatRelative } from "@/lib/utils";

const STATUSES = ["contacted", "responded", "interested", "closed_won", "closed_lost", "no_response"] as const;
const OUTCOMES = ["closed_won", "closed_lost", "not_now", "has_provider"] as const;

const STATUS_COLORS: Record<string, string> = {
  contacted: "bg-sky-50 text-sky-700",
  responded: "bg-violet-50 text-violet-700",
  interested: "bg-amber-50 text-amber-700",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-rose-50 text-rose-700",
  no_response: "bg-slate-50 text-slate-600",
};

type EditState = {
  id: string;
  status: string;
  outcome: string;
  notes: string;
  price_sold: string;
  lead_quality_signal: string;
};

export default function OutreachPage() {
  const token = useAuthStore((s) => s.token);
  const searchParams = useSearchParams();
  const leadIdFilter = searchParams.get("lead_id") ?? undefined;

  const [entries, setEntries] = useState<OutreachEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    listCampaigns(token).then((response) => setCampaigns(response.data)).catch(() => {});
  }, [token]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listOutreach(token, {
          lead_id: leadIdFilter,
          campaign_id: campaignFilter || undefined,
          status: statusFilter || undefined,
          cursor,
          limit: 50,
        });
        if (cursor) {
          setEntries((prev) => [...prev, ...res.data]);
        } else {
          setEntries(res.data);
        }
        setTotal(res.total);
        setNextCursor(res.next_cursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar acciones");
      } finally {
        setLoading(false);
      }
    },
    [token, leadIdFilter, statusFilter, campaignFilter]
  );

  useEffect(() => {
    setEntries([]);
    setNextCursor(null);
    void load();
  }, [statusFilter, campaignFilter, leadIdFilter, token, load]);

  function startEdit(entry: OutreachEntry) {
    setEditing({
      id: entry.id,
      status: entry.status,
      outcome: entry.outcome ?? "",
      notes: entry.notes ?? "",
      price_sold: entry.price_sold != null ? String(entry.price_sold) : "",
      lead_quality_signal: String(entry.lead_quality_signal),
    });
  }

  async function saveEdit() {
    if (!token || !editing) return;
    setSaving(true);
    try {
      const res = await patchOutreach(token, editing.id, {
        status: editing.status,
        outcome: editing.outcome || null,
        notes: editing.notes || undefined,
        price_sold: editing.price_sold ? Number(editing.price_sold) : undefined,
        lead_quality_signal: Number(editing.lead_quality_signal),
      });
      setEntries((prev) => prev.map((entry) => (entry.id === editing.id ? res.data : entry)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active").length;
  const responded = entries.filter((entry) => entry.status === "responded" || entry.status === "interested").length;
  const won = entries.filter((entry) => entry.status === "closed_won").length;

  return (
    <AdminPageLayout
      eyebrow="Acciones"
      title="Seguimiento comercial"
      description="Outreach, respuestas y outcomes en una vista de trabajo orientada a campañas y leads activos."
      actions={
        leadIdFilter ? <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Filtrando por un lead específico</span> : null
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Registros visibles" value={total} hint="Entradas de outreach según filtros activos" />
        <StatCard label="Respuestas / interés" value={responded} hint="Contactos que avanzaron más allá del primer toque" tone="info" />
        <StatCard label="Campañas activas" value={activeCampaigns} hint={won > 0 ? `${won} cierres ganados visibles` : "Sin cierres ganados visibles"} tone="good" />
      </div>

      <SectionCard title="Filtros" description="Acotá por estado o campaña para revisar una cola comercial específica.">
        <div className="flex flex-wrap gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">
            <option value="">Todos los estados</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500">
            <option value="">Todas las campañas</option>
            {campaigns.filter((campaign) => campaign.status !== "closed").map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
            {campaigns.filter((campaign) => campaign.status === "closed").length > 0 ? (
              <optgroup label="Cerradas">
                {campaigns.filter((campaign) => campaign.status === "closed").map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {campaignFilter ? <button onClick={() => setCampaignFilter("")} className="text-sm font-medium text-sky-700 hover:underline">Limpiar campaña</button> : null}
          {leadIdFilter ? <Link href="/admin/outreach" className="text-sm font-medium text-sky-700 hover:underline">Quitar filtro por lead</Link> : null}
        </div>
      </SectionCard>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <SectionCard
        title="Actividad reciente"
        description="Tabla principal para editar estado, outcome y señal comercial sin perder contexto."
        actions={<span className="text-xs text-slate-500">{loading ? "Actualizando…" : `${entries.length} registros en pantalla`}</span>}
      >
        {entries.length === 0 && !loading ? (
          <EmptyPanel title="Sin registros de outreach" description="Todavía no hay acciones para esta combinación de filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Lead</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Canal</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Estado</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Outcome</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-slate-500">Precio</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      Señal
                      <HelpTip label="Señal de calidad">Ajuste manual de calidad comercial observado por quien trabajó el lead.</HelpTip>
                    </span>
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Contactado</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/admin/leads/${entry.lead_id}`} className="text-sky-700 hover:underline text-xs font-medium">
                        {entry.lead_id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{entry.channel}</td>
                    <td className="px-4 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[entry.status] ?? "bg-slate-50 text-slate-600")}>{entry.status}</span></td>
                    <td className="px-4 py-2 text-xs text-slate-500">{entry.outcome ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{entry.price_sold != null ? `UYU ${entry.price_sold.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-2 text-right text-xs font-medium">
                      <span className={cn(entry.lead_quality_signal > 0 ? "text-emerald-700" : entry.lead_quality_signal < 0 ? "text-rose-700" : "text-slate-400")}>
                        {entry.lead_quality_signal > 0 ? `+${entry.lead_quality_signal}` : entry.lead_quality_signal}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">{formatRelative(entry.contacted_at)}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => startEdit(entry)} className="text-xs font-medium text-sky-700 hover:underline">Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {nextCursor ? (
        <div className="text-center">
          <button onClick={() => void load(nextCursor)} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            {loading ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Editar acción comercial</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Estado</label>
                <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Outcome</label>
                <select value={editing.outcome} onChange={(e) => setEditing({ ...editing, outcome: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                  <option value="">Sin outcome</option>
                  {OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Precio vendido (UYU)</label>
                <input type="number" value={editing.price_sold} onChange={(e) => setEditing({ ...editing, price_sold: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Señal de calidad (-10 a +10)</label>
                <input type="number" value={editing.lead_quality_signal} onChange={(e) => setEditing({ ...editing, lead_quality_signal: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" min={-10} max={10} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Notas</label>
                <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={3} className="w-full resize-none rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancelar</button>
              <button onClick={() => void saveEdit()} disabled={saving} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminPageLayout>
  );
}
