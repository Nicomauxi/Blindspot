"use client";

import { useCallback, useEffect, useState } from "react";
import { getSocialEnrichJob, launchSocialEnrichJob, type SocialEnrichJobState } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatRelative } from "@/lib/utils";

const DEFAULT_LIMIT = 1000;
const POLL_MS = 10_000;

// Lanzador del social-enrich aislado (F2-ext Fase 3): corre el CLI en un subproceso
// detached fuera de la API (el browser de Playwright no comparte proceso con Fastify).
// La API aplica el resource-guard (caps de Variables) antes de lanzar.
export function SocialEnrichSection() {
  const token = useAuthStore((s) => s.token);
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  const [force, setForce] = useState(false);
  const [job, setJob] = useState<SocialEnrichJobState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshJob = useCallback(async () => {
    if (!token) return;
    try {
      const res = await getSocialEnrichJob(token);
      setJob(res.data);
    } catch {
      // best-effort
    }
  }, [token]);

  useEffect(() => {
    void refreshJob();
    const id = setInterval(() => void refreshJob(), POLL_MS);
    return () => clearInterval(id);
  }, [refreshJob]);

  async function handleLaunch() {
    if (!token) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const parsedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 8000));
      const res = await launchSocialEnrichJob(token, { limit: parsedLimit, force });
      setJob(res.data);
      setNotice(`Social-enrich lanzado (PID ${res.data.pid ?? "—"}). Seguilo en Estado del run (tipo social).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo lanzar el social-enrich.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm theme-text-muted">
        Mide actividad y liveness de FB/IG con browser en un <strong>subproceso aislado</strong> de la API
        (sobrevive reinicios). La API no lo lanza si la CPU/RAM del host supera los caps de Variables.
        Sin LLM: parsing regex-only, costo cero.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Límite de leads</label>
          <input
            type="number"
            min={1}
            max={8000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <span>Re-medir todo</span>
          <span className="text-xs text-slate-500">(apagado = saltear frescos)</span>
        </label>

        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={loading || job?.running === true}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Lanzando…" : job?.running ? "Corriendo…" : "Lanzar social-enrich"}
        </button>
      </div>

      {job?.running ? (
        <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-slate-700">
          <div className="font-medium text-slate-800">
            Subproceso activo (PID {job.pid ?? "—"}) · iniciado {job.started_at ? formatRelative(job.started_at) : "—"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Límite {job.limit ?? "—"} · {job.force ? "re-midiendo todo" : "salteando frescos"} · log: <code>{job.log_file ?? "—"}</code>
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
    </div>
  );
}
