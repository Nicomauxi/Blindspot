"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listDiscoveryJobs,
  createDiscoveryJob,
  patchDiscoveryJob,
  type DiscoveryJob,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatRelative } from "@/lib/utils";

const SOURCES = ["yelu", "pedidosya", "mintur", "osm"] as const;

const JOB_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-50 text-yellow-700",
  running: "bg-blue-50 text-blue-700 animate-pulse",
  completed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  paused: "bg-orange-50 text-orange-700",
  cancelled: "bg-gray-50 text-gray-500",
};

type NewJobForm = {
  source: string;
  location: string;
  niche: string;
  max_results: string;
  cpu_budget: string;
};

const EMPTY_FORM: NewJobForm = {
  source: "yelu",
  location: "Montevideo",
  niche: "",
  max_results: "200",
  cpu_budget: "balanced",
};

export default function DiscoveryPage() {
  const token = useAuthStore((s) => s.token);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewJobForm>(EMPTY_FORM);

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listDiscoveryJobs(token, {
          status: statusFilter || undefined,
          cursor,
          limit: 20,
        });
        if (cursor) {
          setJobs((prev) => [...prev, ...res.data]);
        } else {
          setJobs(res.data);
        }
        setTotal(res.total);
        setNextCursor(res.next_cursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar jobs");
      } finally {
        setLoading(false);
      }
    },
    [token, statusFilter]
  );

  useEffect(() => {
    setJobs([]);
    setNextCursor(null);
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, token]);

  async function handleCreate() {
    if (!token) return;
    setCreating(true);
    setError(null);
    try {
      await createDiscoveryJob(token, {
        source: form.source,
        location: form.location.trim(),
        niche: form.niche.trim() || undefined,
        max_results: Number(form.max_results),
        cpu_budget: form.cpu_budget,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setJobs([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear job");
    } finally {
      setCreating(false);
    }
  }

  async function handleAction(id: string, action: "pause" | "resume" | "cancel") {
    if (!token) return;
    try {
      const res = await patchDiscoveryJob(token, id, action);
      setJobs((prev) => prev.map((j) => (j.id === id ? res.data : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Error al ${action}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Discovery Control Center</h1>
          <p className="text-xs text-gray-400 mt-0.5">Cola de discovery por fuente y ubicación</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{total} jobs</span>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            + Nuevo job
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">Todos los estados</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={() => load()} className="text-xs text-brand-600 hover:underline px-2">
          Actualizar
        </button>
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
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fuente</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ubicación</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Niche</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Encontrados</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Nuevos</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Creado</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2 font-medium text-gray-700">{job.source}</td>
                <td className="px-4 py-2 text-gray-600">{job.location}</td>
                <td className="px-4 py-2 text-gray-500 text-xs">{job.niche ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", JOB_STATUS_COLORS[job.status] ?? "bg-gray-50")}>
                    {job.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">
                  {job.leads_found != null ? job.leads_found : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {job.leads_new != null ? (
                    <span className={job.leads_new > 0 ? "text-green-700 font-semibold" : "text-gray-400"}>
                      {job.leads_new}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 text-xs text-gray-400">{formatRelative(job.created_at)}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    {job.status === "running" && (
                      <button onClick={() => handleAction(job.id, "pause")} className="text-xs text-orange-600 hover:underline">Pausar</button>
                    )}
                    {job.status === "paused" && (
                      <button onClick={() => handleAction(job.id, "resume")} className="text-xs text-blue-600 hover:underline">Reanudar</button>
                    )}
                    {(job.status === "queued" || job.status === "running" || job.status === "paused") && (
                      <button onClick={() => handleAction(job.id, "cancel")} className="text-xs text-red-600 hover:underline">Cancelar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Sin jobs de discovery
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

      {/* New job modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">Nuevo job de discovery</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fuente</label>
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ubicación</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  placeholder="Montevideo"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Niche (opcional)</label>
                <input
                  type="text"
                  value={form.niche}
                  onChange={(e) => setForm({ ...form, niche: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  placeholder="restaurant"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Máx. resultados</label>
                <input
                  type="number"
                  value={form.max_results}
                  onChange={(e) => setForm({ ...form, max_results: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  min={1}
                  max={1000}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">CPU budget</label>
                <select
                  value={form.cpu_budget}
                  onChange={(e) => setForm({ ...form, cpu_budget: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.location.trim()}
                className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear job"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
