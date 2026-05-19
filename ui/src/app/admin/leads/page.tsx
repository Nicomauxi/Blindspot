"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { listLeads, type LeadDashboard } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const SOURCE_OPTIONS = [
  { value: "", label: "Todas las fuentes" },
  { value: "yelu", label: "Yelu" },
  { value: "pedidosya", label: "PedidosYa" },
  { value: "mintur", label: "MINTUR" },
  { value: "osm", label: "OSM" },
  { value: "google_places", label: "Google Places" },
] as const;

const TIER_OPTIONS = [
  { value: "", label: "Todos los tiers" },
  { value: "A", label: "Tier A" },
  { value: "B", label: "Tier B" },
  { value: "C", label: "Tier C" },
  { value: "D", label: "Tier D" },
  { value: "X", label: "Tier X" },
] as const;

const TIER_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-200",
  B: "bg-blue-100 text-blue-800 border-blue-200",
  C: "bg-yellow-100 text-yellow-800 border-yellow-200",
  D: "bg-gray-100 text-gray-700 border-gray-200",
  X: "bg-red-100 text-red-700 border-red-200",
};

const URGENCY_STYLES: Record<string, string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  low: "bg-gray-50 text-gray-500 border-gray-200",
};

type LoadingPhase = "initial" | "refresh" | "page" | null;

type ActiveFilter = {
  key: string;
  label: string;
  value: string;
  clear: () => void;
};

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}

function getSearchParam(searchParams: ReturnType<typeof useSearchParams>, key: string) {
  return searchParams.get(key) ?? "";
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-gray-300">—</span>;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        TIER_COLORS[tier] ?? "border-gray-200 bg-gray-100 text-gray-700"
      )}
    >
      {tier}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
      {SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source}
    </span>
  );
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
      {children}
    </span>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
      )}
    >
      {label}
    </button>
  );
}

function ActiveFilterPill({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
    >
      <span className="text-brand-600">{label}:</span>
      <span className="max-w-40 truncate">{value}</span>
      <span aria-hidden>×</span>
    </button>
  );
}

function LeadsTableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <tr key={index} className="animate-pulse">
          <td className="px-4 py-3">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-56 rounded bg-gray-100" />
            <div className="mt-2 flex gap-2">
              <div className="h-5 w-16 rounded-full bg-gray-100" />
              <div className="h-5 w-20 rounded-full bg-gray-100" />
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="h-6 w-10 rounded-full bg-gray-100" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="ml-auto h-5 w-10 rounded bg-gray-100" />
          </td>
          <td className="px-4 py-3">
            <div className="h-5 w-24 rounded-full bg-gray-100" />
            <div className="mt-2 h-3 w-16 rounded bg-gray-100" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-32 rounded bg-gray-100" />
            <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="ml-auto h-8 w-16 rounded bg-gray-100" />
          </td>
        </tr>
      ))}
    </>
  );
}

export default function LeadsPage() {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [leads, setLeads] = useState<LeadDashboard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(null);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState(() => getSearchParam(searchParams, "q"));
  const [niche, setNiche] = useState(() => getSearchParam(searchParams, "niche"));
  const [source, setSource] = useState(() => getSearchParam(searchParams, "source"));
  const [tier, setTier] = useState(() => getSearchParam(searchParams, "contact_tier"));
  const [minScore, setMinScore] = useState(() => getSearchParam(searchParams, "prospect_score_gte"));
  const [pageCursors, setPageCursors] = useState<Array<string | null>>(() => [searchParams.get("cursor")]);
  const [pageIndex, setPageIndex] = useState(0);

  const debouncedQ = useDebounce(q, 350);
  const hasLoadedOnceRef = useRef(false);
  const previousFilterKey = useRef<string | null>(null);
  const previousCursor = useRef<string | null>(pageCursors[0] ?? null);
  const latestUrlRef = useRef<string | null>(null);

  const currentCursor = pageCursors[pageIndex] ?? null;
  const loading = loadingPhase !== null;
  const isInitialLoading = loadingPhase === "initial";
  const isRefreshing = loadingPhase === "refresh";
  const isPaging = loadingPhase === "page";

  const resetToFirstPage = useCallback(() => {
    setPageCursors([null]);
    setPageIndex(0);
  }, []);

  const updateUrl = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (niche.trim()) params.set("niche", niche.trim());
      if (source) params.set("source", source);
      if (tier) params.set("contact_tier", tier);
      if (minScore.trim()) params.set("prospect_score_gte", minScore.trim());
      if (cursor) params.set("cursor", cursor);

      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      latestUrlRef.current = nextUrl;
      router.replace(nextUrl, { scroll: false });
    },
    [minScore, niche, pathname, q, router, source, tier]
  );

  const load = useCallback(
    async (cursor: string | null, phase: Exclude<LoadingPhase, null>) => {
      if (!token) return;

      setLoadingPhase(phase);
      setError(null);

      try {
        const response = await listLeads(token, {
          q: debouncedQ.trim() || undefined,
          niche: niche.trim() || undefined,
          source: source || undefined,
          contact_tier: tier || undefined,
          prospect_score_gte: minScore ? Number(minScore) : undefined,
          cursor: cursor || undefined,
          limit: PAGE_SIZE,
        });

        setLeads(response.data);
        setTotal(response.total);
        setNextCursor(response.next_cursor);
        hasLoadedOnceRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar leads");
      } finally {
        setLoadingPhase(null);
      }
    },
    [debouncedQ, minScore, niche, source, tier, token]
  );

  useEffect(() => {
    const currentUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
    if (latestUrlRef.current === currentUrl) return;

    const urlQ = getSearchParam(searchParams, "q");
    const urlNiche = getSearchParam(searchParams, "niche");
    const urlSource = getSearchParam(searchParams, "source");
    const urlTier = getSearchParam(searchParams, "contact_tier");
    const urlMinScore = getSearchParam(searchParams, "prospect_score_gte");
    const urlCursor = searchParams.get("cursor");

    if (urlQ !== q) setQ(urlQ);
    if (urlNiche !== niche) setNiche(urlNiche);
    if (urlSource !== source) setSource(urlSource);
    if (urlTier !== tier) setTier(urlTier);
    if (urlMinScore !== minScore) setMinScore(urlMinScore);

    if (urlCursor !== currentCursor) {
      setPageCursors([urlCursor]);
      setPageIndex(0);
    }
  }, [currentCursor, minScore, niche, pathname, q, searchParams, source, tier]);

  useEffect(() => {
    updateUrl(currentCursor);
  }, [currentCursor, updateUrl]);

  useEffect(() => {
    if (!token) return;

    const filterKey = JSON.stringify({
      q: debouncedQ.trim(),
      niche: niche.trim(),
      source,
      tier,
      minScore: minScore.trim(),
    });
    const filtersChanged = previousFilterKey.current !== filterKey;
    const cursorChanged = previousCursor.current !== currentCursor;

    previousFilterKey.current = filterKey;
    previousCursor.current = currentCursor;

    const phase: Exclude<LoadingPhase, null> = !hasLoadedOnceRef.current
      ? "initial"
      : filtersChanged
        ? "refresh"
        : cursorChanged
          ? "page"
          : "refresh";

    void load(currentCursor, phase);
  }, [currentCursor, debouncedQ, load, minScore, niche, source, tier, token]);

  const activeFilters: ActiveFilter[] = [
    q.trim()
      ? { key: "q", label: "Buscar", value: q.trim(), clear: () => setQ("") }
      : null,
    niche.trim()
      ? { key: "niche", label: "Niche", value: niche.trim(), clear: () => setNiche("") }
      : null,
    source
      ? {
          key: "source",
          label: "Fuente",
          value: SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source,
          clear: () => setSource(""),
        }
      : null,
    tier
      ? {
          key: "tier",
          label: "Tier",
          value: TIER_OPTIONS.find((option) => option.value === tier)?.label ?? tier,
          clear: () => setTier(""),
        }
      : null,
    minScore.trim()
      ? { key: "score", label: "Score mín.", value: minScore.trim(), clear: () => setMinScore("") }
      : null,
  ].filter((value): value is ActiveFilter => value !== null);

  const hasActiveFilters = activeFilters.length > 0;
  const showLargeDatasetHint = total >= 500 && !hasActiveFilters;
  const currentStart = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const currentEnd = total === 0 ? 0 : pageIndex * PAGE_SIZE + leads.length;

  function clearAllFilters() {
    setQ("");
    setNiche("");
    setSource("");
    setTier("");
    setMinScore("");
    resetToFirstPage();
  }

  function handleSearchChange(value: string) {
    setQ(value);
    resetToFirstPage();
  }

  function handleNicheChange(value: string) {
    setNiche(value);
    resetToFirstPage();
  }

  function handleSourceChange(value: string) {
    setSource(value);
    resetToFirstPage();
  }

  function handleTierChange(value: string) {
    setTier(value);
    resetToFirstPage();
  }

  function handleMinScoreChange(value: string) {
    setMinScore(value);
    resetToFirstPage();
  }

  function goToPreviousPage() {
    if (pageIndex === 0 || loading) return;
    setPageIndex((current) => Math.max(current - 1, 0));
  }

  function goToNextPage() {
    if (!nextCursor || loading) return;

    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-2 border-b border-gray-200 bg-gray-50/95 px-2 pb-4 pt-1 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">Lead Explorer</h1>
              {isRefreshing && (
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  Actualizando resultados…
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Exploración operativa rápida para filtrar, escanear y abrir leads sin perder contexto.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-gray-900">{total.toLocaleString("es-UY")} leads</p>
            <p className="text-xs text-gray-500">
              {total > 0 ? `Mostrando ${currentStart}-${currentEnd}` : "Sin resultados cargados"}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-4">
            <div className="flex flex-wrap items-start gap-3 xl:flex-nowrap">
              <div className="relative min-w-[320px] flex-1">
                <input
                  type="search"
                  placeholder="Buscar nombre, dirección o niche"
                  value={q}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 transition-colors hover:text-gray-600"
                    aria-label="Limpiar búsqueda"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="min-w-[280px] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fuente</p>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_OPTIONS.map((option) => (
                    <FilterChip
                      key={option.value || "all"}
                      label={option.label}
                      active={source === option.value}
                      onClick={() => handleSourceChange(option.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="min-w-[250px] flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tier</p>
                <div className="flex flex-wrap gap-2">
                  {TIER_OPTIONS.map((option) => (
                    <FilterChip
                      key={option.value || "all"}
                      label={option.label}
                      active={tier === option.value}
                      onClick={() => handleTierChange(option.value)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Niche</span>
                <input
                  type="text"
                  placeholder="Ej: restaurante"
                  value={niche}
                  onChange={(event) => handleNicheChange(event.target.value)}
                  className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Score mín.</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(event) => handleMinScoreChange(event.target.value)}
                  placeholder="0"
                  className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </label>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mb-0.5 text-sm font-medium text-brand-600 transition-colors hover:text-brand-700 hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {hasActiveFilters ? `${activeFilters.length} filtros activos` : "Sin filtros activos"}
              </span>
              {activeFilters.map((filter) => (
                <ActiveFilterPill
                  key={filter.key}
                  label={filter.label}
                  value={filter.value}
                  onClear={() => {
                    filter.clear();
                    resetToFirstPage();
                  }}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Bloque {pageIndex + 1}</span>
              <span className="text-gray-300">•</span>
              <span>{total > 0 ? `${currentStart}-${currentEnd}` : "0-0"} de {total.toLocaleString("es-UY")}</span>
            </div>
          </div>
        </div>
      </div>

      {showLargeDatasetHint && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Dataset grande. Afiná por fuente, tier o score para acelerar el barrido operativo.
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(currentCursor, hasLoadedOnceRef.current ? "refresh" : "initial")}
            className="font-medium text-red-700 underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Lead</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tier</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Score</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Señales</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Oferta</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isInitialLoading && leads.length === 0 && <LeadsTableSkeleton />}

              {!isInitialLoading && leads.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-gray-50/80">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/admin/leads/${lead.id}`}
                      className="text-sm font-semibold text-gray-900 transition-colors hover:text-brand-700 hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <p className="mt-1 max-w-md truncate text-xs text-gray-500">{lead.address ?? "Sin dirección cargada"}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <SourceBadge source={lead.source} />
                      {lead.niche && <MetaBadge>{lead.niche}</MetaBadge>}
                      <MetaBadge>{lead.state}</MetaBadge>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1.5">
                      <TierBadge tier={lead.contact_tier} />
                      {lead.contact_ready != null && (
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            lead.contact_ready ? "text-green-700" : "text-gray-400"
                          )}
                        >
                          {lead.contact_ready ? "Contacto listo" : "Contacto incompleto"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {lead.prospect_score != null ? (
                      <div>
                        <span
                          className={cn(
                            "font-mono text-base font-semibold",
                            lead.prospect_score >= 70
                              ? "text-green-700"
                              : lead.prospect_score >= 45
                                ? "text-yellow-700"
                                : "text-gray-500"
                          )}
                        >
                          {lead.prospect_score}
                        </span>
                        <p className="mt-1 text-[11px] text-gray-400">sobre 100</p>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-2">
                      <span
                        className={cn(
                          "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          URGENCY_STYLES[lead.urgency_signal ?? ""] ?? "border-gray-200 bg-gray-50 text-gray-500"
                        )}
                      >
                        {lead.urgency_signal ?? "Sin urgencia"}
                      </span>
                      <div className="space-y-1 text-[11px] text-gray-500">
                        <p>
                          {lead.corroborating_sources?.length > 0
                            ? `+${lead.corroborating_sources.length} fuentes corroboradas`
                            : "Sin corroboración extra"}
                        </p>
                        {lead.canonical_source && <p>Canónica: {lead.canonical_source}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="max-w-xs truncate text-sm text-gray-700">{lead.primary_offer ?? "Sin oferta principal"}</p>
                    <p className="mt-1 max-w-xs truncate text-xs text-gray-400">{lead.pitch_hook ?? "Sin pitch hook"}</p>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <Link
                      href={`/admin/leads/${lead.id}`}
                      className="inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && leads.length === 0 && (
          <div className="px-6 py-12 text-center">
            {hasActiveFilters ? (
              <>
                <p className="text-sm font-medium text-gray-700">No hay resultados para esta combinación de filtros.</p>
                <p className="mt-1 text-sm text-gray-500">Probá limpiar una fuente, bajar el score mínimo o volver a todos los tiers.</p>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100"
                >
                  Limpiar filtros
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">Todavía no hay leads para explorar.</p>
                <p className="mt-1 text-sm text-gray-500">Cuando el dataset tenga registros, esta vista va a priorizar el barrido rápido.</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-gray-500">
          {loading
            ? isPaging
              ? "Cambiando de bloque…"
              : "Actualizando listado…"
            : total > 0
              ? `Mostrando ${currentStart}-${currentEnd} de ${total.toLocaleString("es-UY")} leads`
              : "Sin resultados para mostrar"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToPreviousPage}
            disabled={pageIndex === 0 || loading}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior 50
          </button>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={!nextCursor || loading}
            className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente 50
          </button>
        </div>
      </div>
    </div>
  );
}
