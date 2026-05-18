"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { listOutreach, patchOutreach, type OutreachEntry } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatRelative } from "@/lib/utils";

const STATUSES = ["contacted", "responded", "interested", "closed_won", "closed_lost", "no_response"] as const;
const OUTCOMES = ["closed_won", "closed_lost", "not_now", "has_provider"] as const;

const STATUS_COLORS: Record<string, string> = {
  contacted: "bg-blue-50 text-blue-700",
  responded: "bg-purple-50 text-purple-700",
  interested: "bg-yellow-50 text-yellow-700",
  closed_won: "bg-green-50 text-green-700",
  closed_lost: "bg-red-50 text-red-700",
  no_response: "bg-gray-50 text-gray-600",
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
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listOutreach(token, {
          lead_id: leadIdFilter,
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
        setError(err instanceof Error ? err.message : "Error al cargar outreach");
      } finally {
        setLoading(false);
      }
    },
    [token, leadIdFilter, statusFilter]
  );

  useEffect(() => {
    setEntries([]);
    setNextCursor(null);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, leadIdFilter, token]);

  function startEdit(e: OutreachEntry) {
    setEditing({
      id: e.id,
      status: e.status,
      outcome: e.outcome ?? "",
      notes: e.notes ?? "",
      price_sold: e.price_sold != null ? String(e.price_sold) : "",
      lead_quality_signal: String(e.lead_quality_signal),
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
      setEntries((prev) => prev.map((e) => (e.id === editing.id ? res.data : e)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Outreach Tracker</h1>
          {leadIdFilter && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              Filtrando por lead
              <Link href="/admin/outreach" className="ml-1 text-brand-600 hover:underline">× limpiar</Link>
            </span>
          )}
        </div>
        <span className="text-sm text-gray-500">{total} registros</span>
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Canal</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Outcome</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Precio</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Señal</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Contactado</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2">
                  <Link href={`/admin/leads/${e.lead_id}`} className="text-brand-600 hover:underline text-xs">
                    {e.lead_id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-700">{e.channel}</td>
                <td className="px-4 py-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", STATUS_COLORS[e.status] ?? "bg-gray-50 text-gray-600")}>
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs">{e.outcome ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {e.price_sold != null ? `UYU ${e.price_sold.toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <span className={cn("text-xs font-medium", e.lead_quality_signal > 0 ? "text-green-700" : e.lead_quality_signal < 0 ? "text-red-700" : "text-gray-400")}>
                    {e.lead_quality_signal > 0 ? `+${e.lead_quality_signal}` : e.lead_quality_signal}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-400">{formatRelative(e.contacted_at)}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => startEdit(e)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Sin registros de outreach
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-4 text-center">
          <button
            onClick={() => load(nextCursor)}
            disabled={loading}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">Editar outreach</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Estado</label>
                <select
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Outcome</label>
                <select
                  value={editing.outcome}
                  onChange={(e) => setEditing({ ...editing, outcome: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Sin outcome</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Precio vendido (UYU)</label>
                <input
                  type="number"
                  value={editing.price_sold}
                  onChange={(e) => setEditing({ ...editing, price_sold: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Señal de calidad (-10 a +10)</label>
                <input
                  type="number"
                  value={editing.lead_quality_signal}
                  onChange={(e) => setEditing({ ...editing, lead_quality_signal: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  min={-10}
                  max={10}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notas</label>
                <textarea
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={3}
                  className="w-full border rounded px-2 py-1.5 text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
