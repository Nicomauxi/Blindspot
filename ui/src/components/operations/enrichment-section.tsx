"use client";

import { useEffect, useMemo, useState } from "react";
import { createFilteredEnrichmentJob, estimateEnrichmentImpact, getAdminVariables } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const ENRICH_LIMIT = 250;
const DEFAULT_MAX_THREADS = 4;
const PREVIEW_DEBOUNCE_MS = 450;

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
  const [concurrency, setConcurrency] = useState(String(DEFAULT_MAX_THREADS));
  const [maxThreads, setMaxThreads] = useState(DEFAULT_MAX_THREADS);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  // Tope de hilos configurado en Variables (max_enrich_threads).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getAdminVariables(token)
      .then((res) => {
        if (cancelled) return;
        const item = res.data.find((v) => v.key === "max_enrich_threads");
        const value = typeof item?.value === "number" ? item.value : DEFAULT_MAX_THREADS;
        const bounded = Math.max(1, Math.min(32, value));
        setMaxThreads(bounded);
        setConcurrency((prev) => String(Math.min(Number(prev) || DEFAULT_MAX_THREADS, bounded)));
      })
      .catch(() => {
        /* mantiene el default si Variables no responde */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const threadOptions = useMemo(() => {
    const opts: number[] = [];
    for (let n = 1; n <= maxThreads; n += 1) opts.push(n);
    return opts;
  }, [maxThreads]);

  // Preview de conteo en vivo (debounced) usando el endpoint estimate.
  useEffect(() => {
    if (!token || filterCount === 0) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const handle = setTimeout(() => {
      estimateEnrichmentImpact(token, filters)
        .then((res) => {
          if (cancelled) return;
          setPreview(res.data.lead_count);
          setPreviewLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setPreview(null);
          setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [token, filters, filterCount]);

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
        concurrency: Math.min(Number(concurrency) || DEFAULT_MAX_THREADS, maxThreads),
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
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hilos simultáneos</label>
          <select
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {threadOptions.map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </select>
          <span className="text-xs text-slate-400">máx {maxThreads}</span>
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

      {filterCount > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3">
          <span className="text-2xl font-semibold text-sky-700">
            {previewLoading ? "…" : preview ?? "—"}
          </span>
          <div className="text-sm text-slate-600">
            <div className="font-medium text-slate-700">leads coinciden con los filtros</div>
            {preview != null && preview > ENRICH_LIMIT ? (
              <div className="text-xs text-amber-700">
                Se procesarán los primeros {ENRICH_LIMIT} por operación.
              </div>
            ) : (
              <div className="text-xs text-slate-400">Estimación en vivo según tu selección.</div>
            )}
          </div>
        </div>
      ) : null}

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
