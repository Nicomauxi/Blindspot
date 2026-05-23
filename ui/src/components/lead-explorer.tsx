"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmptyPanel, HelpTip, SectionCard } from "@/components/admin-shell";
import { listLeads, type LeadDashboard } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

type LeadExplorerMode = "full" | "embedded";
type LoadingPhase = "initial" | "refresh" | "page" | null;
type ActiveFilter = {
  key: string;
  label: string;
  value: string;
  clear: () => void;
};

type LeadExplorerProps = {
  mode: LeadExplorerMode;
  initialFilters?: Partial<{
    q: string;
    niche: string;
    source: string;
    tier: string;
    minScore: string;
    primaryOffer: string;
    sortValue: string;
  }>;
  pageSize?: number;
};

const FULL_PAGE_SIZE = 50;
const EMBEDDED_PAGE_SIZE = 6;
const DEFAULT_SORT = "created_at:desc";

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

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Más nuevos" },
  { value: "prospect_score:desc", label: "Score alto primero" },
  { value: "prospect_score:asc", label: "Score bajo primero" },
] as const;

const PRESETS = [
  { id: "hot", label: "Hot leads", description: "Score 70+", apply: () => ({ minScore: "70" }) },
  { id: "tier_a", label: "Tier A", description: "Mejor base de contacto", apply: () => ({ tier: "A" }) },
  { id: "google", label: "Google Places", description: "Barrido por fuente", apply: () => ({ source: "google_places" }) },
  { id: "offer", label: "Oferta sugerida", description: "Ordenar por score", apply: () => ({ sortValue: "prospect_score:desc" }) },
] as const;

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-sky-100 text-sky-800 border-sky-200",
  C: "bg-amber-100 text-amber-800 border-amber-200",
  D: "bg-slate-100 text-slate-700 border-slate-200",
  X: "bg-rose-100 text-rose-700 border-rose-200",
};

const URGENCY_STYLES: Record<string, string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}

function readSearchParam(searchParams: ReturnType<typeof useSearchParams>, key: string) {
  return searchParams.get(key) ?? "";
}

function parseSortValue(value: string): { sort_by: "created_at" | "prospect_score"; sort_direction: "asc" | "desc" } {
  const [sortBy, sortDirection] = value.split(":");
  return {
    sort_by: sortBy === "prospect_score" ? "prospect_score" : "created_at",
    sort_direction: sortDirection === "asc" ? "asc" : "desc",
  };
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-slate-300">—</span>;

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", TIER_COLORS[tier] ?? "border-slate-200 bg-slate-100 text-slate-700")}>
      {tier}
    </span>
  );
}

function SmallPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600", className)}>{children}</span>;
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {label}
    </button>
  );
}

function ActiveFilterPill({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100"
    >
      <span className="text-sky-600">{label}:</span>
      <span className="max-w-40 truncate">{value}</span>
      <span aria-hidden>×</span>
    </button>
  );
}

function LeadRow({ lead }: { lead: LeadDashboard }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-4 transition-colors hover:border-sky-200 hover:bg-sky-50/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/leads/${lead.id}`} className="text-base font-semibold text-slate-900 transition-colors hover:text-sky-700 hover:underline">
              {lead.name}
            </Link>
            <TierBadge tier={lead.contact_tier} />
            <SmallPill>{SOURCE_OPTIONS.find((option) => option.value === lead.source)?.label ?? lead.source}</SmallPill>
            {lead.owner_group_id ? <SmallPill>Mismo propietario</SmallPill> : null}
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{lead.address ?? "Sin dirección cargada"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
            {lead.niche ? <SmallPill>{lead.niche}</SmallPill> : null}
            <SmallPill>{lead.state}</SmallPill>
            <SmallPill>{lead.contact_ready ? "Contacto listo" : "Contacto incompleto"}</SmallPill>
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-medium", URGENCY_STYLES[lead.urgency_signal ?? ""] ?? "border-slate-200 bg-slate-50 text-slate-500")}>
              {lead.urgency_signal ?? "Sin urgencia"}
            </span>
          </div>
        </div>

        <div className="grid gap-2 text-right sm:min-w-52">
          <div>
            <div className="text-2xl font-semibold text-slate-900">{lead.prospect_score ?? "—"}</div>
            <p className="text-xs text-slate-500">prospect score</p>
          </div>
          <div className="text-xs text-slate-500">
            {lead.corroborating_sources?.length > 0 ? `+${lead.corroborating_sources.length} fuentes corroboradas` : "Sin corroboración extra"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr,1fr,auto] xl:items-start">
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Diagnóstico rápido
            <HelpTip label="Diagnóstico rápido">Resume por qué el lead merece atención: urgencia, readiness de contacto y señales comerciales visibles.</HelpTip>
          </div>
          <p className="mt-2 text-sm text-slate-700">
            {lead.pitch_hook ?? "Todavía no hay pitch hook visible. Revisá la ficha para entender mejor el ángulo comercial."}
          </p>
        </div>

        <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-3">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Oferta sugerida</span>
            {lead.primary_offer ? <SmallPill className="bg-sky-100 text-sky-700">Filtro clave</SmallPill> : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-800">{lead.primary_offer ?? "Sin oferta principal"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {lead.contact_ready ? "Listo para pasar a una propuesta o contacto inicial." : "Conviene validar datos de contacto antes de salir a prospectar."}
          </p>
        </div>

        <div className="flex items-center justify-end xl:justify-start">
          <Link href={`/admin/leads/${lead.id}`} className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100">
            Abrir ficha
          </Link>
        </div>
      </div>
    </div>
  );
}

export function LeadExplorer({ mode, initialFilters, pageSize }: LeadExplorerProps) {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFull = mode === "full";
  const effectivePageSize = pageSize ?? (isFull ? FULL_PAGE_SIZE : EMBEDDED_PAGE_SIZE);

  const initialQ = isFull ? readSearchParam(searchParams, "q") : initialFilters?.q ?? "";
  const initialNiche = isFull ? readSearchParam(searchParams, "niche") : initialFilters?.niche ?? "";
  const initialSource = isFull ? readSearchParam(searchParams, "source") : initialFilters?.source ?? "";
  const initialTier = isFull ? readSearchParam(searchParams, "contact_tier") : initialFilters?.tier ?? "";
  const initialMinScore = isFull ? readSearchParam(searchParams, "prospect_score_gte") : initialFilters?.minScore ?? "";
  const initialOffer = isFull ? readSearchParam(searchParams, "primary_offer") : initialFilters?.primaryOffer ?? "";
  const initialSortValue = isFull
    ? `${readSearchParam(searchParams, "sort_by") || "created_at"}:${readSearchParam(searchParams, "sort_direction") || "desc"}`
    : initialFilters?.sortValue ?? DEFAULT_SORT;

  const [leads, setLeads] = useState<LeadDashboard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [niche, setNiche] = useState(initialNiche);
  const [source, setSource] = useState(initialSource);
  const [tier, setTier] = useState(initialTier);
  const [minScore, setMinScore] = useState(initialMinScore);
  const [primaryOffer, setPrimaryOffer] = useState(initialOffer);
  const [sortValue, setSortValue] = useState(initialSortValue || DEFAULT_SORT);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([isFull ? searchParams.get("cursor") : null]);
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
  const currentStart = total === 0 ? 0 : pageIndex * effectivePageSize + 1;
  const currentEnd = total === 0 ? 0 : pageIndex * effectivePageSize + leads.length;
  const showLargeDatasetHint = isFull && total >= 500 && !q && !niche && !source && !tier && !minScore && !primaryOffer;
  const sortParams = useMemo(() => parseSortValue(sortValue), [sortValue]);

  const resetToFirstPage = useCallback(() => {
    setPageCursors([null]);
    setPageIndex(0);
  }, []);

  const updateUrl = useCallback(
    (cursor: string | null) => {
      if (!isFull) return;
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (niche.trim()) params.set("niche", niche.trim());
      if (source) params.set("source", source);
      if (tier) params.set("contact_tier", tier);
      if (minScore.trim()) params.set("prospect_score_gte", minScore.trim());
      if (primaryOffer.trim()) params.set("primary_offer", primaryOffer.trim());
      if (sortValue !== DEFAULT_SORT) {
        params.set("sort_by", sortParams.sort_by);
        params.set("sort_direction", sortParams.sort_direction);
      }
      if (cursor) params.set("cursor", cursor);

      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      latestUrlRef.current = nextUrl;
      router.replace(nextUrl, { scroll: false });
    },
    [isFull, minScore, niche, pathname, primaryOffer, q, router, sortParams.sort_by, sortParams.sort_direction, sortValue, source, tier]
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
          primary_offer: primaryOffer.trim() || undefined,
          sort_by: sortParams.sort_by,
          sort_direction: sortParams.sort_direction,
          cursor: cursor || undefined,
          limit: effectivePageSize,
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
    [debouncedQ, effectivePageSize, minScore, niche, primaryOffer, sortParams.sort_by, sortParams.sort_direction, source, tier, token]
  );

  useEffect(() => {
    if (!isFull) return;
    const currentUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
    if (latestUrlRef.current === currentUrl) return;

    const urlQ = readSearchParam(searchParams, "q");
    const urlNiche = readSearchParam(searchParams, "niche");
    const urlSource = readSearchParam(searchParams, "source");
    const urlTier = readSearchParam(searchParams, "contact_tier");
    const urlMinScore = readSearchParam(searchParams, "prospect_score_gte");
    const urlOffer = readSearchParam(searchParams, "primary_offer");
    const urlSortBy = readSearchParam(searchParams, "sort_by") || "created_at";
    const urlSortDirection = readSearchParam(searchParams, "sort_direction") || "desc";
    const urlSort = `${urlSortBy}:${urlSortDirection}`;
    const urlCursor = searchParams.get("cursor");

    if (urlQ !== q) setQ(urlQ);
    if (urlNiche !== niche) setNiche(urlNiche);
    if (urlSource !== source) setSource(urlSource);
    if (urlTier !== tier) setTier(urlTier);
    if (urlMinScore !== minScore) setMinScore(urlMinScore);
    if (urlOffer !== primaryOffer) setPrimaryOffer(urlOffer);
    if (urlSort !== sortValue) setSortValue(urlSort);
    if (urlCursor !== currentCursor) {
      setPageCursors([urlCursor]);
      setPageIndex(0);
    }
  }, [currentCursor, isFull, minScore, niche, pathname, primaryOffer, q, searchParams, sortValue, source, tier]);

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
      primaryOffer: primaryOffer.trim(),
      sortValue,
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
  }, [currentCursor, debouncedQ, load, minScore, niche, primaryOffer, sortValue, source, tier, token]);

  const activeFilters: ActiveFilter[] = [
    q.trim() ? { key: "q", label: "Buscar", value: q.trim(), clear: () => setQ("") } : null,
    niche.trim() ? { key: "niche", label: "Niche", value: niche.trim(), clear: () => setNiche("") } : null,
    source ? { key: "source", label: "Fuente", value: SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source, clear: () => setSource("") } : null,
    tier ? { key: "tier", label: "Tier", value: TIER_OPTIONS.find((option) => option.value === tier)?.label ?? tier, clear: () => setTier("") } : null,
    minScore.trim() ? { key: "score", label: "Score mín.", value: minScore.trim(), clear: () => setMinScore("") } : null,
    primaryOffer.trim() ? { key: "offer", label: "Oferta", value: primaryOffer.trim(), clear: () => setPrimaryOffer("") } : null,
    sortValue !== DEFAULT_SORT ? { key: "sort", label: "Orden", value: SORT_OPTIONS.find((option) => option.value === sortValue)?.label ?? sortValue, clear: () => setSortValue(DEFAULT_SORT) } : null,
  ].filter((value): value is ActiveFilter => value !== null);

  function clearAllFilters() {
    setQ("");
    setNiche("");
    setSource("");
    setTier("");
    setMinScore("");
    setPrimaryOffer("");
    setSortValue(DEFAULT_SORT);
    resetToFirstPage();
  }

  function applyPreset(presetId: string) {
    const preset = PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    const values = preset.apply() as Partial<{ minScore: string; tier: string; source: string; sortValue: string }>;
    if (values.minScore !== undefined) setMinScore(values.minScore);
    if (values.tier !== undefined) setTier(values.tier);
    if (values.source !== undefined) setSource(values.source);
    if (values.sortValue !== undefined) setSortValue(values.sortValue);
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

  const filtersContent = (
    <div className="space-y-4">
      <div className={cn("grid gap-3", isFull ? "xl:grid-cols-[1.4fr,1fr,1fr,1fr]" : "md:grid-cols-2 xl:grid-cols-4")}>
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar
            <HelpTip label="Buscar">Busca por nombre, dirección o nicho. Ideal para volver a un lead conocido o barrer un segmento concreto.</HelpTip>
          </div>
          <input
            type="search"
            placeholder="Nombre, dirección o niche"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              resetToFirstPage();
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Niche</div>
          <input
            type="text"
            placeholder="Ej: restaurante"
            value={niche}
            onChange={(event) => {
              setNiche(event.target.value);
              resetToFirstPage();
            }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Oferta sugerida</div>
          <input
            type="text"
            placeholder="Ej: sitio_web"
            value={primaryOffer}
            onChange={(event) => {
              setPrimaryOffer(event.target.value);
              resetToFirstPage();
            }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ordenar por</div>
          <select
            value={sortValue}
            onChange={(event) => {
              setSortValue(event.target.value);
              resetToFirstPage();
            }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Score mínimo</div>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(event) => {
              setMinScore(event.target.value);
              resetToFirstPage();
            }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fuente</p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((option) => (
              <FilterChip key={option.value || "all-source"} label={option.label} active={source === option.value} onClick={() => {
                setSource(option.value);
                resetToFirstPage();
              }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier de contacto</p>
          <div className="flex flex-wrap gap-2">
            {TIER_OPTIONS.map((option) => (
              <FilterChip key={option.value || "all-tier"} label={option.label} active={tier === option.value} onClick={() => {
                setTier(option.value);
                resetToFirstPage();
              }} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {activeFilters.length > 0 ? `${activeFilters.length} filtros activos` : "Sin filtros activos"}
        </span>
        {activeFilters.map((filter) => (
          <ActiveFilterPill key={filter.key} label={filter.label} value={filter.value} onClear={() => {
            filter.clear();
            resetToFirstPage();
          }} />
        ))}
        {activeFilters.length > 0 ? (
          <button type="button" onClick={clearAllFilters} className="text-sm font-medium text-sky-700 hover:underline">
            Limpiar todo
          </button>
        ) : null}
        {!isFull ? (
          <Link href="/admin/leads" className="ml-auto text-sm font-medium text-sky-700 hover:underline">
            Abrir versión completa
          </Link>
        ) : null}
      </div>
    </div>
  );

  const listContent = isInitialLoading && leads.length === 0 ? (
    <div className="space-y-3">
      {Array.from({ length: isFull ? 6 : 3 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-2xl border border-slate-200 px-4 py-4">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-64 rounded bg-slate-100" />
          <div className="mt-4 h-16 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  ) : leads.length === 0 ? (
    <EmptyPanel
      title={activeFilters.length > 0 ? "No hay leads para esta combinación de filtros" : "Todavía no hay leads para explorar"}
      description={activeFilters.length > 0 ? "Probá bajar el score mínimo, cambiar la fuente o volver a todos los tiers." : "Cuando entren registros, esta vista va a convertirse en la cola principal de trabajo."}
      action={activeFilters.length > 0 ? <button type="button" onClick={clearAllFilters} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">Limpiar filtros</button> : undefined}
    />
  ) : (
    <div className="space-y-3">
      {leads.map((lead) => (
        <LeadRow key={lead.id} lead={lead} />
      ))}
    </div>
  );

  if (!isFull) {
    return (
      <div className="space-y-4">
        {filtersContent}
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={() => void load(currentCursor, hasLoadedOnceRef.current ? "refresh" : "initial")} className="font-medium underline underline-offset-2">
              Reintentar
            </button>
          </div>
        ) : null}
        {listContent}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          <span>{loading ? "Actualizando…" : total > 0 ? `Mostrando ${currentStart}-${currentEnd} de ${total.toLocaleString("es-UY")} leads` : "Sin resultados para mostrar"}</span>
          <Link href="/admin/leads" className="font-medium text-sky-700 hover:underline">
            Abrir Lead Explorer
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Colas sugeridas" description="Atajos rápidos para empezar el barrido del día.">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
            >
              <div className="text-sm font-medium text-slate-900">{preset.label}</div>
              <div className="text-xs text-slate-500">{preset.description}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Filtros" description="Afiná la búsqueda según valor comercial, origen y preparación del contacto.">
        {filtersContent}
      </SectionCard>

      {showLargeDatasetHint ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Dataset grande. Empezá por una cola sugerida o filtrá por fuente, tier, score u oferta para acelerar el barrido operativo.
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load(currentCursor, hasLoadedOnceRef.current ? "refresh" : "initial")} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </div>
      ) : null}

      <SectionCard
        title="Listado"
        description="Cada fila resume valor, contexto y próxima lectura del lead antes de abrir la ficha."
        actions={<span className="text-xs text-slate-500">{loading ? isPaging ? "Cambiando de bloque…" : isRefreshing ? "Actualizando…" : "Cargando…" : `Bloque ${pageIndex + 1}`}</span>}
      >
        {listContent}
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-slate-500">
          {loading ? isPaging ? "Cambiando de bloque…" : isRefreshing ? "Actualizando resultados…" : "Cargando…" : total > 0 ? `Mostrando ${currentStart}-${currentEnd} de ${total.toLocaleString("es-UY")} leads` : "Sin resultados para mostrar"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToPreviousPage}
            disabled={pageIndex === 0 || loading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior {effectivePageSize}
          </button>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={!nextCursor || loading}
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente {effectivePageSize}
          </button>
        </div>
      </div>
    </div>
  );
}
