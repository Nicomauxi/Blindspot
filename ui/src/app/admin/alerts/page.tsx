"use client";

import { useCallback, useEffect, useState } from "react";
import { archiveAlert, listAlerts, markAlertRead, type SystemAlert } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { AdminPageLayout } from "@/components/admin-shell";
import { formatRelative } from "@/lib/utils";

const PAGE_SIZE = 20;

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  read: "bg-emerald-50 text-emerald-700",
  archived: "bg-slate-50 text-slate-400",
};

type FilterStatus = "all" | "pending" | "read" | "archived";

export default function AlertsPage() {
  const token = useAuthStore((s) => s.token);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (status: FilterStatus, off: number) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = {
          limit: PAGE_SIZE + 1,
          offset: off,
          ...(status !== "all" ? { status } : {}),
        };
        const res = await listAlerts(token, params);
        const items = res.data;
        setHasMore(items.length > PAGE_SIZE);
        setAlerts(items.slice(0, PAGE_SIZE));
      } catch {
        // non-blocking
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    setOffset(0);
    void load(filterStatus, 0);
  }, [filterStatus, load]);

  async function handleMarkRead(id: string) {
    if (!token) return;
    await markAlertRead(token, id).catch(() => undefined);
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "read" as const } : a))
    );
  }

  async function handleArchive(id: string) {
    if (!token) return;
    await archiveAlert(token, id).catch(() => undefined);
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "archived" as const } : a))
    );
  }

  function handlePrev() {
    const newOffset = Math.max(0, offset - PAGE_SIZE);
    setOffset(newOffset);
    void load(filterStatus, newOffset);
  }

  function handleNext() {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    void load(filterStatus, newOffset);
  }

  const statusTabs: { value: FilterStatus; label: string }[] = [
    { value: "pending", label: "Pendientes" },
    { value: "read", label: "Leídas" },
    { value: "archived", label: "Archivadas" },
    { value: "all", label: "Todas" },
  ];

  return (
    <AdminPageLayout
      eyebrow="Sistema"
      title="Alertas"
      description="Historial de alertas del sistema ordenadas por fecha de creación."
    >
      <div className="theme-panel rounded-2xl">
        <div className="flex gap-1 border-b px-4 pt-4" style={{ borderColor: "var(--border)" }}>
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilterStatus(tab.value)}
              className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                filterStatus === tab.value
                  ? "border-b-2 border-sky-500 text-sky-700"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500" style={{ borderColor: "var(--border)" }}>
                <th className="px-4 py-3">Severidad</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3 hidden md:table-cell">Descripción</th>
                <th className="px-4 py-3 hidden lg:table-cell">Estado</th>
                <th className="px-4 py-3 hidden lg:table-cell">Fecha</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    No hay alertas en esta categoría.
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => (
                  <tr
                    key={alert.id}
                    className="border-b last:border-0 hover:bg-slate-50"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[alert.severity] ?? "bg-slate-100 text-slate-600"}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{alert.title}</td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell max-w-xs truncate">
                      {alert.description}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[alert.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {alert.status}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-400 lg:table-cell whitespace-nowrap">
                      {formatRelative(alert.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {alert.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => void handleMarkRead(alert.id)}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            title="Marcar leída"
                          >
                            Leída
                          </button>
                        ) : null}
                        {alert.status !== "archived" ? (
                          <button
                            type="button"
                            onClick={() => void handleArchive(alert.id)}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            title="Archivar"
                          >
                            Archivar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && (offset > 0 || hasMore) ? (
          <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              disabled={offset === 0}
              onClick={handlePrev}
              className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50"
            >
              ← Anterior
            </button>
            <span className="text-xs text-slate-400">
              Mostrando {offset + 1}–{offset + alerts.length}
            </span>
            <button
              type="button"
              disabled={!hasMore}
              onClick={handleNext}
              className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50"
            >
              Siguiente →
            </button>
          </div>
        ) : null}
      </div>
    </AdminPageLayout>
  );
}
