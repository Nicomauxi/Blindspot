"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { archiveAlert, getAlertsUnreadCount, listAlerts, markAlertRead, type SystemAlert } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatRelative } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
};

export function AlertsBell() {
  const token = useAuthStore((s) => s.token);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    if (!token) return;
    try {
      const res = await getAlertsUnreadCount(token);
      setCount(res.data.count);
    } catch {
      // non-blocking
    }
  }, [token]);

  useEffect(() => {
    void fetchCount();
    const timer = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchCount]);

  useEffect(() => {
    if (!open || !token) return;
    setLoadingAlerts(true);
    listAlerts(token, { status: "pending", limit: 10 })
      .then((res) => setAlerts(res.data))
      .catch(() => undefined)
      .finally(() => setLoadingAlerts(false));
  }, [open, token]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleMarkRead(id: string) {
    if (!token) return;
    await markAlertRead(token, id).catch(() => undefined);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setCount((c) => Math.max(0, c - 1));
  }

  async function handleArchive(id: string) {
    if (!token) return;
    await archiveAlert(token, id).catch(() => undefined);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setCount((c) => Math.max(0, c - 1));
  }

  return (
    <div className="relative z-30" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `${count} alertas sin leer` : "Sin alertas"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white transition-colors hover:bg-slate-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="size-4 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-[70] mt-2 w-80 rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">Alertas pendientes</span>
            <span className="text-xs text-slate-400">{count} sin leer</span>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loadingAlerts ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</div>
            ) : alerts.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">Sin alertas pendientes</div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className={`border-b border-slate-100 px-4 py-3 last:border-0 ${SEVERITY_STYLES[alert.severity] ?? ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{alert.title}</p>
                      <p className="mt-0.5 text-xs opacity-80 leading-snug">{alert.description}</p>
                      <p className="mt-1 text-xs opacity-60">{formatRelative(alert.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(alert.id)}
                        className="rounded px-1.5 py-0.5 text-xs hover:bg-black/10"
                        title="Marcar leída"
                      >✓</button>
                      <button
                        type="button"
                        onClick={() => void handleArchive(alert.id)}
                        className="rounded px-1.5 py-0.5 text-xs hover:bg-black/10"
                        title="Archivar"
                      >✕</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2.5">
            <Link href="/admin/alerts" onClick={() => setOpen(false)} className="text-xs font-medium text-sky-600 hover:underline">
              Ver todas las alertas →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
