"use client";

import { useMemo, useState } from "react";
import { createFilteredEnrichmentJob } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const ENRICH_LIMIT = 250;

const SOURCE_OPTIONS = [
  { value: "", label: "Todas las fuentes" },
  { value: "google_places", label: "Google Places" },
  { value: "mintur", label: "MINTUR" },
  { value: "osm", label: "OpenStreetMap" },
  { value: "yelu", label: "Yelu" },
  { value: "pedidosya", label: "PedidosYa" },
];

const TIER_OPTIONS = [
  { value: "", label: "Todos los tiers" },
  { value: "A", label: "Tier A" },
  { value: "B", label: "Tier B" },
  { value: "C", label: "Tier C" },
];

export function EnrichmentSection() {
  const token = useAuthStore((s) => s.token);
  const [tier, setTier] = useState("");
  const [minScore, setMinScore] = useState("");
  const [niche, setNiche] = useState("");
  const [source, setSource] = useState("");
  const [primaryOffer, setPrimaryOffer] = useState("");
  const [q, setQ] = useState("");
  const [withHeuristic, setWithHeuristic] = useState(true);
  const [concurrency, setConcurrency] = useState("4");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(() => ({
    ...(tier ? { contact_tier: tier } : {}),
    ...(minScore.trim() ? { prospect_score_gte: Number(minScore.trim()) } : {}),
    ...(niche.trim() ? { niche: niche.trim() } : {}),
    ...(source ? { source } : {}),
    ...(primaryOffer.trim() ? { primary_offer: primaryOffer.trim() } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }), [minScore, niche, primaryOffer, q, source, tier]);

  const filterCount = useMemo(() => Object.keys(filters).length, [filters]);

  const guardrail = useMemo(() => {
    if (filterCount === 0) return "Definí al menos un filtro antes de encolar enrichment.";
    return "";
  }, [filterCount]);

  function clearFilters() {
    setTier("");
    setMinScore("");
    setNiche("");
    setSource("");
    setPrimaryOffer("");
    setQ("");
  }

  async function handleSubmit() {
    if (!token || guardrail) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await createFilteredEnrichmentJob(token, {
        ...filters,
        with_heuristic: withHeuristic,
        concurrency: Number(concurrency) || 4,
      });
      setNotice(`Enrichment encolado para ${response.data.lead_count} leads. Run ${response.data.run_id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo encolar el enrichment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm theme-text-muted">
        Seleccioná un subconjunto de leads por filtros y lanzá enrichment sobre esa colección. Límite operativo: {ENRICH_LIMIT} leads por operación.
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buscar (nombre/dirección)</label>
          <input
            type="search"
            placeholder="Nombre, dirección o nicho"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nicho</label>
          <input
            type="text"
            placeholder="ej: restaurante"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Score mínimo</label>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="ej: 50"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contact Tier</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {TIER_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fuente</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {SOURCE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Oferta principal</label>
          <input
            type="text"
            placeholder="ej: delivery"
            value={primaryOffer}
            onChange={(e) => setPrimaryOffer(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Concurrencia</label>
          <select
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="6">6</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={withHeuristic}
            onChange={(e) => setWithHeuristic(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <span>With heuristic</span>
          <span className="text-xs text-slate-500">(website/social/WhatsApp discovery)</span>
        </label>

        {filterCount > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            Limpiar {filterCount} filtro{filterCount !== 1 ? "s" : ""}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || Boolean(guardrail)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50",
            guardrail ? "bg-slate-400" : "bg-sky-600 hover:bg-sky-700"
          )}
        >
          {loading ? "Encolando…" : "Enriquecer colección"}
        </button>
      </div>

      {guardrail ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{guardrail}</div> : null}
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
    </div>
  );
}
