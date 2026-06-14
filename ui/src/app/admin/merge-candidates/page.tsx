"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listMergeCandidates,
  approveMergeCandidate,
  rejectMergeCandidate,
  type MergeCandidate,
  type MergeCandidateLead,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const REASON_LABELS: Record<string, string> = {
  "city-mismatch": "Ciudad distinta",
  "chain-suspected": "Posible cadena/sucursal",
  "shared-domain-low-name-sim": "Mismo dominio, nombre dispar",
};

const KIND_LABELS: Record<string, string> = {
  phone: "Teléfono",
  domain: "Dominio web",
  email: "Email",
};

function LeadCard({ lead, tag }: { lead: MergeCandidateLead; tag: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{tag}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{lead.source}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{lead.name}</p>
      <p className="text-xs text-slate-500">{lead.address ?? "Sin dirección"}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
        {lead.phone ? <span>📞 {lead.phone}</span> : null}
        {lead.website ? <span className="truncate max-w-[160px]">🌐 {lead.website}</span> : null}
        {lead.niche ? <span className="rounded bg-slate-100 px-1.5">{lead.niche}</span> : null}
        {lead.prospect_score != null ? <span>Score {lead.prospect_score}</span> : null}
      </div>
    </div>
  );
}

export default function MergeCandidatesPage() {
  const token = useAuthStore((s) => s.token);
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listMergeCandidates(token);
      setCandidates(res.data);
    } catch {
      setError("No se pudieron cargar los candidatos de unión.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (!token) return;
      setBusyId(id);
      setError(null);
      try {
        if (action === "approve") await approveMergeCandidate(token, id);
        else await rejectMergeCandidate(token, id);
        setCandidates((current) => current.filter((c) => c.id !== id));
      } catch {
        setError(action === "approve" ? "No se pudo fusionar el lead." : "No se pudo rechazar el candidato.");
      } finally {
        setBusyId(null);
      }
    },
    [token]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Cola de unión de leads</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pares de leads de distintas fuentes que comparten contacto pero requieren confirmación humana antes de
              fusionar (la unión borra el lead secundario, absorbiéndolo en el primario).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Cargando candidatos…
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No hay uniones pendientes de revisión. 🎉
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{candidates.length} pares pendientes</p>
          {candidates.map((c) => (
            <div key={c.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-700">
                  {REASON_LABELS[c.reason] ?? c.reason}
                </span>
                <span className="rounded-full bg-sky-100 px-2 py-1 font-medium text-sky-700">
                  {KIND_LABELS[c.match_kind] ?? c.match_kind}: {c.match_key}
                </span>
                <span className="text-slate-500">Similitud nombre {(c.name_similarity * 100).toFixed(0)}%</span>
                <span className="text-slate-500">{c.same_city ? "Misma ciudad" : "Ciudad no confirmada"}</span>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <LeadCard lead={c.primary} tag="Se conserva (primario)" />
                <div className="flex items-center justify-center text-slate-400">←</div>
                <LeadCard lead={c.secondary} tag="Se absorbe (secundario)" />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void resolve(c.id, "reject")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void resolve(c.id, "approve")}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busyId === c.id ? "Procesando…" : "Fusionar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
