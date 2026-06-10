"use client";

import { useState } from "react";
import {
  createFilteredEnrichmentJob,
  estimateEnrichmentImpact,
  type MissingFilters,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/admin-shell";

const MISSING_FILTER_OPTIONS: { key: keyof MissingFilters; label: string }[] = [
  { key: "missing_gps", label: "Sin GPS" },
  { key: "missing_address", label: "Sin dirección" },
  { key: "missing_phone", label: "Sin teléfono" },
  { key: "missing_whatsapp", label: "Sin WhatsApp" },
  { key: "missing_email", label: "Sin email" },
  { key: "missing_website", label: "Sin sitio web" },
];

const REFRESH_ENRICH_LIMIT = 250;

type RefreshMode = "enrichment" | "re_discovery";

const MODE_OPTIONS: { value: RefreshMode; label: string; description: string }[] = [
  { value: "enrichment", label: "Enrichment", description: "Re-corre el pipeline de enriquecimiento (sitio web, redes, teléfono)." },
  { value: "re_discovery", label: "Re-discovery", description: "Refresca datos de Google Places (rating, teléfono, horarios, GPS) — solo leads con place_id." },
];

export function RefreshMasivoSection() {
  const token = useAuthStore((state) => state.token);
  const [mode, setMode] = useState<RefreshMode>("enrichment");
  const [missingFilters, setMissingFilters] = useState<MissingFilters>({});
  const [tier, setTier] = useState("");
  const [minScore, setMinScore] = useState("");
  const [niche, setNiche] = useState("");
  const [source, setSource] = useState("");
  const [impact, setImpact] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const anyMissing = Object.values(missingFilters).some(Boolean);
  const anyFilter = anyMissing || Boolean(tier || minScore || niche || source);

  function buildFilters() {
    return {
      ...missingFilters,
      ...(tier ? { contact_tier: tier } : {}),
      ...(minScore.trim() ? { prospect_score_gte: Number(minScore.trim()) } : {}),
      ...(niche.trim() ? { niche: niche.trim() } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
    };
  }

  async function handleEstimate() {
    if (!token || !anyFilter) return;
    setEstimating(true);
    setError(null);
    setImpact(null);
    try {
      const res = await estimateEnrichmentImpact(token, buildFilters());
      setImpact(res.data.lead_count);
      if (res.data.lead_count > REFRESH_ENRICH_LIMIT) {
        setError(`El filtro alcanza ${res.data.lead_count} leads, supera el límite de ${REFRESH_ENRICH_LIMIT}. Agregá más filtros.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al estimar.");
    } finally {
      setEstimating(false);
    }
  }

  async function handleLaunch() {
    if (!token || !anyFilter || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setConfirmPending(false);
    try {
      const res = await createFilteredEnrichmentJob(token, {
        ...buildFilters(),
        mode,
        with_heuristic: true,
        concurrency: 4,
      });
      const modeLabel = mode === "re_discovery" ? "Re-discovery" : "Enrichment";
      setNotice(`${modeLabel} encolado para ${res.data.lead_count} leads · Run ${res.data.run_id}.`);
      setImpact(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al lanzar el job.");
    } finally {
      setLoading(false);
    }
  }

  const launchLabel = mode === "re_discovery" ? "Lanzar re-discovery" : "Lanzar enrichment";

  return (
    <SectionCard title="Refresh masivo" description="Refresca datos de leads por filtros. Soporta filtros missing_* para detectar datos faltantes.">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Modo</p>
          <div className="flex gap-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setMode(opt.value); setImpact(null); setNotice(null); setError(null); }}
                className={cn(
                  "rounded-xl border px-4 py-2 text-left transition-colors",
                  mode === opt.value
                    ? "border-sky-300 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                )}
              >
                <p className="text-xs font-semibold">{opt.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Datos faltantes</p>
          <div className="flex flex-wrap gap-2">
            {MISSING_FILTER_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMissingFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  missingFilters[key] ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">Todos</option>
              {["A","B","C","D","X"].map((t) => <option key={t} value={t}>Tier {t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Score mínimo</label>
            <input type="number" min="0" max="100" placeholder="ej: 50" value={minScore} onChange={(e) => setMinScore(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nicho</label>
            <input type="text" placeholder="restaurante" value={niche} onChange={(e) => setNiche(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fuente</label>
            <input type="text" placeholder="google_places" value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
        </div>

        {!anyFilter && (
          <p className="text-xs text-amber-700">Seleccioná al menos un filtro antes de estimar.</p>
        )}

        {impact != null && impact <= REFRESH_ENRICH_LIMIT && (
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{impact}</span> leads coinciden con el filtro.
            {impact > 50 && !confirmPending && (
              <span className="ml-2 text-xs text-amber-600">— más de 50 leads, confirmación requerida.</span>
            )}
          </p>
        )}

        {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleEstimate()}
            disabled={estimating || !anyFilter}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {estimating ? "Estimando…" : "Estimar impacto"}
          </button>

          {impact != null && impact > 0 && impact <= REFRESH_ENRICH_LIMIT && (
            impact > 50 && !confirmPending ? (
              <button
                type="button"
                onClick={() => setConfirmPending(true)}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Confirmar ({impact} leads)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleLaunch()}
                disabled={loading}
                className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {loading ? "Lanzando…" : launchLabel}
              </button>
            )
          )}

          {confirmPending && (
            <button type="button" onClick={() => setConfirmPending(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
