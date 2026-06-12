"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmptyPanel, HelpTip, SectionCard } from "@/components/admin-shell";
import { LeadReviewMap } from "@/components/lead-review-map";
import {
  getLeadDensity,
  getZoneLeads,
  listGeoZones,
  listLeads,
  listNicheAliasGroups,
  type CommercialOfferType,
  type DiscoveryGeoZone,
  type DiscoveryHeatMetric,
  type DiscoveryLeadDensityFilters,
  type DiscoveryLeadDensityMeta,
  type DiscoveryMapDensityLocation,
  type DiscoveryMapViewportBounds,
  type LeadDashboard,
  type LeadGeoSelection,
  type NicheAliasGroup,
  type ZoneLead,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  buildLeadExplorerGeoSelection,
  buildZoneLeadRequest,
  parseGranularLocationKey,
} from "@/lib/location-density-map";
import { cn } from "@/lib/utils";

type LeadExplorerMode = "full" | "embedded";
type LoadingPhase = "initial" | "refresh" | "page" | null;
type ActiveFilter = {
  key: string;
  label: string;
  value: string;
  clear: () => void;
};

type ExplorerFilterState = {
  q: string;
  niche: string;
  source: string;
  tier: string;
  minScore: string;
  primaryOffer: string;
  commercialOfferType: CommercialOfferType | "";
  sortValue: string;
  parentLocationKeys: string[];
  gridLocationKeys: string[];
};

type GeoSelectionDraft = {
  zoneIds: string[];
  selectedLocationKey: string | null;
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
    commercialOfferType: CommercialOfferType | "";
    sortValue: string;
  }>;
  pageSize?: number;
  geoSelection?: LeadGeoSelection & { label?: string };
  onGeoSelectionClear?: () => void;
};

const FULL_PAGE_SIZE = 50;
const EMBEDDED_PAGE_SIZE = 10;
const EMBEDDED_LIST_VIEWPORT_CLASS = "max-h-[52rem] overflow-y-auto pr-1";
const DEFAULT_SORT = "created_at:desc";
const DEFAULT_DENSITY_FILTERS: DiscoveryLeadDensityFilters = { prospect_score_gte: 0, limit: 4000, heat_metric: "mixed" };
const SOURCE_OPTIONS = [
  { value: "", label: "Todas las fuentes" },
  { value: "yelu", label: "Yelu" },
  { value: "pedidosya", label: "PedidosYa" },
  { value: "mintur", label: "MINTUR" },
  { value: "osm", label: "OSM" },
  { value: "google_places", label: "Google Places" },
] as const;

const TIER_OPTIONS = [
  { value: "", label: "Toda calidad de contacto" },
  { value: "A", label: "Contacto A" },
  { value: "B", label: "Contacto B" },
  { value: "C", label: "Contacto C" },
  { value: "D", label: "Contacto D" },
  { value: "X", label: "Contacto X" },
] as const;

const COMMERCIAL_OFFER_TYPE_OPTIONS: Array<{ value: CommercialOfferType | ""; label: string }> = [
  { value: "", label: "Todas" },
  { value: "marketing", label: "Marketing" },
  { value: "software", label: "Software" },
  { value: "both", label: "Marketing + Software" },
  { value: "unknown", label: "Sin señal suficiente" },
];

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Más nuevos" },
  { value: "prospect_score:desc", label: "Score alto primero" },
  { value: "prospect_score:asc", label: "Score bajo primero" },
  { value: "marketing_score:desc", label: "Marketing alto primero" },
  { value: "software_score:desc", label: "Software alto primero" },
  { value: "offer_balance:desc", label: "Mayor diferencia de señal" },
] as const;

// Umbral canónico de "hot lead" (prospect_score). Alineado con el backend
// (discovery-insights, performance, costs usan >= 55).
const HOT_LEAD_THRESHOLD = 55;

const PRESETS = [
  { id: "hot", label: "Hot leads", description: `Score ${HOT_LEAD_THRESHOLD}+`, apply: () => ({ minScore: String(HOT_LEAD_THRESHOLD) }) },
  { id: "tier_a", label: "Contacto A", description: "Calidad de contacto (≠ valor)", apply: () => ({ tier: "A" }) },
  { id: "google", label: "Google Places", description: "Barrido por fuente", apply: () => ({ source: "google_places" }) },
  { id: "offer", label: "Oferta sugerida", description: "Ordenar por score", apply: () => ({ sortValue: "prospect_score:desc" }) },
  { id: "software", label: "Software", description: "Priorizar oportunidad operativa", apply: () => ({ commercialOfferType: "software", sortValue: "software_score:desc" }) },
  { id: "marketing", label: "Marketing", description: "Priorizar señal de visibilidad", apply: () => ({ commercialOfferType: "marketing", sortValue: "marketing_score:desc" }) },
] as const;

// F3.2: contact_tier es CALIDAD DE CONTACTO, no valor comercial. Se quita el verde de A
// (insinuaba "lead bueno") por un índigo neutro; el valor vive en prospect_score/brecha.
const TIER_COLORS: Record<string, string> = {
  A: "bg-indigo-100 text-indigo-800 border-indigo-200",
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

function readSearchParam(searchParams: ReturnType<typeof useSearchParams>, key: string) {
  return searchParams.get(key) ?? "";
}

function readCsvSearchParam(searchParams: ReturnType<typeof useSearchParams>, key: string) {
  const raw = searchParams.get(key) ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseSortValue(value: string): { sort_by: "created_at" | "prospect_score" | "marketing_score" | "software_score" | "offer_balance"; sort_direction: "asc" | "desc" } {
  const [sortBy, sortDirection] = value.split(":");
  return {
    sort_by:
      sortBy === "prospect_score" ||
      sortBy === "marketing_score" ||
      sortBy === "software_score" ||
      sortBy === "offer_balance"
        ? sortBy
        : "created_at",
    sort_direction: sortDirection === "asc" ? "asc" : "desc",
  };
}

function createEmptyFilterState(): ExplorerFilterState {
  return {
    q: "",
    niche: "",
    source: "",
    tier: "",
    minScore: "",
    primaryOffer: "",
    commercialOfferType: "",
    sortValue: DEFAULT_SORT,
    parentLocationKeys: [],
    gridLocationKeys: [],
  };
}

function buildFilterState(overrides: Partial<ExplorerFilterState> = {}): ExplorerFilterState {
  return {
    ...createEmptyFilterState(),
    ...overrides,
    parentLocationKeys: overrides.parentLocationKeys ?? [],
    gridLocationKeys: overrides.gridLocationKeys ?? [],
    sortValue: overrides.sortValue ?? DEFAULT_SORT,
    commercialOfferType: overrides.commercialOfferType ?? "",
  };
}

function serializeExplorerFilters(filters: ExplorerFilterState): string {
  return JSON.stringify({
    q: filters.q.trim(),
    niche: filters.niche.trim(),
    source: filters.source,
    tier: filters.tier,
    minScore: filters.minScore.trim(),
    primaryOffer: filters.primaryOffer.trim(),
    commercialOfferType: filters.commercialOfferType,
    sortValue: filters.sortValue,
    parentLocationKeys: filters.parentLocationKeys.join(","),
    gridLocationKeys: filters.gridLocationKeys.join(","),
  });
}

function isGeoSelectionEqual(left: GeoSelectionDraft, right: GeoSelectionDraft): boolean {
  return left.selectedLocationKey === right.selectedLocationKey && left.zoneIds.join(",") === right.zoneIds.join(",");
}

function hasMeaningfulFilters(filters: ExplorerFilterState): boolean {
  return Boolean(
    filters.q.trim() ||
      filters.niche.trim() ||
      filters.source ||
      filters.tier ||
      filters.minScore.trim() ||
      filters.primaryOffer.trim() ||
      filters.commercialOfferType ||
      filters.parentLocationKeys.length > 0 ||
      filters.gridLocationKeys.length > 0
  );
}

function buildExplorerHref(filters: ExplorerFilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.niche.trim()) params.set("niche", filters.niche.trim());
  if (filters.source) params.set("source", filters.source);
  if (filters.tier) params.set("contact_tier", filters.tier);
  if (filters.minScore.trim()) params.set("prospect_score_gte", filters.minScore.trim());
  if (filters.primaryOffer.trim()) params.set("primary_offer", filters.primaryOffer.trim());
  if (filters.commercialOfferType) params.set("commercial_offer_type", filters.commercialOfferType);
  if (filters.parentLocationKeys.length > 0) params.set("parent_location_keys", filters.parentLocationKeys.join(","));
  if (filters.gridLocationKeys.length > 0) params.set("grid_location_keys", filters.gridLocationKeys.join(","));
  const sort = parseSortValue(filters.sortValue);
  if (filters.sortValue !== DEFAULT_SORT) {
    params.set("sort_by", sort.sort_by);
    params.set("sort_direction", sort.sort_direction);
  }
  return params.toString() ? "/admin/leads?" + params.toString() : "/admin/leads";
}

function describeZoneSelection(zoneIds: string[], zones: DiscoveryGeoZone[]): string | null {
  if (zoneIds.length === 0) return null;
  const labels = zoneIds.map((zoneId) => zones.find((zone) => zone.zone_id === zoneId)?.label ?? zoneId);
  if (labels.length === 1) return labels[0] ?? null;
  return labels.length + " zonas";
}

function selectedLocationKeyFromFilters(filters: ExplorerFilterState): string | null {
  if (filters.parentLocationKeys.length !== 1 || filters.gridLocationKeys.length !== 1) return null;
  return filters.parentLocationKeys[0] + "::" + filters.gridLocationKeys[0];
}

function zoneIdsFromFilters(filters: ExplorerFilterState): string[] {
  if (filters.gridLocationKeys.length > 0) return [];
  return filters.parentLocationKeys;
}

function buildDensityFilters(filters: ExplorerFilterState, zoneIds: string[]): DiscoveryLeadDensityFilters {
  return {
    ...DEFAULT_DENSITY_FILTERS,
    source: filters.source ? [filters.source] : undefined,
    niche: filters.niche.trim() || undefined,
    prospect_score_gte: filters.minScore.trim() ? Number(filters.minScore.trim()) || 0 : 0,
    contact_tier: filters.tier ? [filters.tier] : undefined,
    primary_offer: filters.primaryOffer.trim() || undefined,
    commercial_offer_type: filters.commercialOfferType || undefined,
    zone_ids: zoneIds.length > 0 ? zoneIds : undefined,
  };
}

function buildEffectiveGeoFilters(
  selectedLocationKey: string | null,
  locations: DiscoveryMapDensityLocation[],
  zoneIds: string[],
  zones: DiscoveryGeoZone[]
): { parentLocationKeys: string[]; gridLocationKeys: string[]; label: string } {
  if (selectedLocationKey) {
    const selectedLocation = locations.find((location) => location.location_key === selectedLocationKey);
    if (selectedLocation) {
      const selection = buildLeadExplorerGeoSelection(selectedLocation);
      return {
        parentLocationKeys: selection.parent_location_keys ?? [],
        gridLocationKeys: selection.grid_location_keys ?? [],
        label: selection.label,
      };
    }

    const parsed = parseGranularLocationKey(selectedLocationKey);
    if (parsed) {
      return {
        parentLocationKeys: [parsed.parentLocationKey],
        gridLocationKeys: [parsed.gridLocationKey],
        label: selectedLocationKey,
      };
    }
  }

  return {
    parentLocationKeys: zoneIds,
    gridLocationKeys: [],
    label: describeZoneSelection(zoneIds, zones) ?? "",
  };
}

function buildSelectedFilters(
  filters: ExplorerFilterState,
  geoLabel: string,
  onClearGeo: () => void,
  setters: {
    setQ: () => void;
    setNiche: () => void;
    setSource: () => void;
    setTier: () => void;
    setMinScore: () => void;
    setPrimaryOffer: () => void;
    setCommercialOfferType: () => void;
    setSortValue: () => void;
  }
): ActiveFilter[] {
  return [
    filters.q.trim() ? { key: "q", label: "Buscar", value: filters.q.trim(), clear: setters.setQ } : null,
    filters.niche.trim() ? { key: "niche", label: "Niche", value: filters.niche.trim(), clear: setters.setNiche } : null,
    filters.source ? { key: "source", label: "Fuente", value: SOURCE_OPTIONS.find((option) => option.value === filters.source)?.label ?? filters.source, clear: setters.setSource } : null,
    filters.tier ? { key: "tier", label: "Calidad de contacto", value: TIER_OPTIONS.find((option) => option.value === filters.tier)?.label ?? filters.tier, clear: setters.setTier } : null,
    filters.minScore.trim() ? { key: "score", label: "Score mín.", value: filters.minScore.trim(), clear: setters.setMinScore } : null,
    filters.primaryOffer.trim() ? { key: "offer", label: "Oferta", value: filters.primaryOffer.trim(), clear: setters.setPrimaryOffer } : null,
    filters.commercialOfferType ? { key: "commercial-offer-type", label: "Tipo comercial", value: getCommercialOfferTypeLabel(filters.commercialOfferType), clear: setters.setCommercialOfferType } : null,
    filters.parentLocationKeys.length > 0 || filters.gridLocationKeys.length > 0 ? { key: "geo", label: "Mapa", value: geoLabel || "Zona geográfica", clear: onClearGeo } : null,
    filters.sortValue !== DEFAULT_SORT ? { key: "sort", label: "Orden", value: SORT_OPTIONS.find((option) => option.value === filters.sortValue)?.label ?? filters.sortValue, clear: setters.setSortValue } : null,
  ].filter((value): value is ActiveFilter => value !== null);
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-slate-300">—</span>;

  return (
    <span
      title="Calidad de contacto (≠ valor comercial). El valor está en el score y la brecha."
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", TIER_COLORS[tier] ?? "border-slate-200 bg-slate-100 text-slate-700")}
    >
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

function getCommercialOfferTypeLabel(type: CommercialOfferType | ""): string {
  return COMMERCIAL_OFFER_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Sin señal suficiente";
}

function getCommercialOfferTypeBadgeClass(type: CommercialOfferType | "unknown") {
  if (type === "marketing") return "bg-fuchsia-100 text-fuchsia-700";
  if (type === "software") return "bg-emerald-100 text-emerald-700";
  if (type === "both") return "bg-violet-100 text-violet-700";
  return "bg-slate-100 text-slate-600";
}

function formatCommercialScores(lead: LeadDashboard) {
  const summary = lead.commercial_offers_summary;
  if (!summary) return "Sin score comercial derivado";
  return "MKT " + summary.marketing_score + " · SW " + summary.software_score;
}

function LeadRow({ lead }: { lead: LeadDashboard }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-4 transition-colors hover:border-sky-200 hover:bg-sky-50/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={"/admin/leads/" + lead.id} className="text-base font-semibold text-slate-900 transition-colors hover:text-sky-700 hover:underline">
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
            {lead.corroborating_sources?.length > 0 ? "+" + lead.corroborating_sources.length + " fuentes corroboradas" : "Sin corroboración extra"}
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">{lead.primary_offer ?? "Sin oferta principal"}</p>
            {lead.commercial_offers_summary ? (
              <SmallPill className={getCommercialOfferTypeBadgeClass(lead.commercial_offers_summary.primary_offer_type)}>
                {getCommercialOfferTypeLabel(lead.commercial_offers_summary.primary_offer_type)}
              </SmallPill>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">{formatCommercialScores(lead)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {lead.contact_ready ? "Listo para pasar a una propuesta o contacto inicial." : "Conviene validar datos de contacto antes de salir a prospectar."}
          </p>
        </div>

        <div className="flex items-center justify-end xl:justify-start">
          <Link href={"/admin/leads/" + lead.id} className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100">
            Abrir ficha
          </Link>
        </div>
      </div>
    </div>
  );
}

export function LeadExplorer({ mode, initialFilters, pageSize, geoSelection, onGeoSelectionClear }: LeadExplorerProps) {
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFull = mode === "full";
  const effectivePageSize = pageSize ?? (isFull ? FULL_PAGE_SIZE : EMBEDDED_PAGE_SIZE);

  const initialState = useMemo(() => {
    if (isFull) {
      return buildFilterState({
        q: readSearchParam(searchParams, "q"),
        niche: readSearchParam(searchParams, "niche"),
        source: readSearchParam(searchParams, "source"),
        tier: readSearchParam(searchParams, "contact_tier"),
        minScore: readSearchParam(searchParams, "prospect_score_gte"),
        primaryOffer: readSearchParam(searchParams, "primary_offer"),
        commercialOfferType: readSearchParam(searchParams, "commercial_offer_type") as CommercialOfferType | "",
        parentLocationKeys: readCsvSearchParam(searchParams, "parent_location_keys"),
        gridLocationKeys: readCsvSearchParam(searchParams, "grid_location_keys"),
        sortValue: (readSearchParam(searchParams, "sort_by") || "created_at") + ":" + (readSearchParam(searchParams, "sort_direction") || "desc"),
      });
    }

    return buildFilterState({
      q: initialFilters?.q ?? "",
      niche: initialFilters?.niche ?? "",
      source: initialFilters?.source ?? "",
      tier: initialFilters?.tier ?? "",
      minScore: initialFilters?.minScore ?? "",
      primaryOffer: initialFilters?.primaryOffer ?? "",
      commercialOfferType: initialFilters?.commercialOfferType ?? "",
      sortValue: initialFilters?.sortValue ?? DEFAULT_SORT,
      parentLocationKeys: geoSelection?.parent_location_keys ?? [],
      gridLocationKeys: geoSelection?.grid_location_keys ?? [],
    });
  }, [geoSelection?.grid_location_keys, geoSelection?.parent_location_keys, initialFilters, isFull, searchParams]);

  const [leads, setLeads] = useState<LeadDashboard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<ExplorerFilterState>(initialState);
  const [appliedFilters, setAppliedFilters] = useState<ExplorerFilterState>(initialState);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([isFull ? searchParams.get("cursor") : null]);
  const [pageIndex, setPageIndex] = useState(0);

  const [densityLocations, setDensityLocations] = useState<DiscoveryMapDensityLocation[]>([]);
  const [densityMeta, setDensityMeta] = useState<DiscoveryLeadDensityMeta | null>(null);
  const [densityLoading, setDensityLoading] = useState(false);
  const [densityError, setDensityError] = useState<string | null>(null);
  const [zoneOptions, setZoneOptions] = useState<DiscoveryGeoZone[]>([]);
  const [zoneOptionsLoading, setZoneOptionsLoading] = useState(false);
  const [zoneOptionsError, setZoneOptionsError] = useState<string | null>(null);
  const [zoneSearch, setZoneSearch] = useState("");
  const [nicheGroups, setNicheGroups] = useState<NicheAliasGroup[]>([]);
  const [zoneLeads, setZoneLeads] = useState<ZoneLead[] | null>(null);
  const [zoneLeadsTotal, setZoneLeadsTotal] = useState(0);
  const [zoneLeadsLoading, setZoneLeadsLoading] = useState(false);
  const [zoneLeadsError, setZoneLeadsError] = useState<string | null>(null);
  const [draftHeatMetric, setDraftHeatMetric] = useState<DiscoveryHeatMetric>("mixed");
  const [appliedHeatMetric, setAppliedHeatMetric] = useState<DiscoveryHeatMetric>("mixed");
  const [mapViewport, setMapViewport] = useState<{ zoom?: number; bbox?: DiscoveryMapViewportBounds }>({});
  const [viewportLeads, setViewportLeads] = useState<ZoneLead[]>([]);
  const [draftGeoSelection, setDraftGeoSelection] = useState<GeoSelectionDraft>({
    zoneIds: zoneIdsFromFilters(initialState),
    selectedLocationKey: selectedLocationKeyFromFilters(initialState),
  });
  const [appliedGeoSelection, setAppliedGeoSelection] = useState<GeoSelectionDraft>({
    zoneIds: zoneIdsFromFilters(initialState),
    selectedLocationKey: selectedLocationKeyFromFilters(initialState),
  });

  const hasLoadedOnceRef = useRef(false);
  const previousFilterKey = useRef<string | null>(null);
  const previousCursor = useRef<string | null>(pageCursors[0] ?? null);
  const latestUrlRef = useRef<string | null>(null);
  const previousDensityFilterKey = useRef<string | null>(null);

  const currentCursor = pageCursors[pageIndex] ?? null;
  const loading = loadingPhase !== null;
  const isInitialLoading = loadingPhase === "initial";
  const isRefreshing = loadingPhase === "refresh";
  const isPaging = loadingPhase === "page";
  const currentStart = total === 0 ? 0 : pageIndex * effectivePageSize + 1;
  const currentEnd = total === 0 ? 0 : pageIndex * effectivePageSize + leads.length;
  const sortParams = useMemo(() => parseSortValue(appliedFilters.sortValue), [appliedFilters.sortValue]);

  const draftDensityFilters = useMemo(() => ({ ...buildDensityFilters(draftFilters, draftGeoSelection.zoneIds), heat_metric: draftHeatMetric }), [draftFilters, draftGeoSelection.zoneIds, draftHeatMetric]);
  const appliedDensityFilters = useMemo(() => ({ ...buildDensityFilters(appliedFilters, appliedGeoSelection.zoneIds), heat_metric: appliedHeatMetric }), [appliedFilters, appliedGeoSelection.zoneIds, appliedHeatMetric]);
  const draftGeoAppliedValues = useMemo(
    () => buildEffectiveGeoFilters(draftGeoSelection.selectedLocationKey, densityLocations, draftGeoSelection.zoneIds, zoneOptions),
    [densityLocations, draftGeoSelection.selectedLocationKey, draftGeoSelection.zoneIds, zoneOptions]
  );
  const appliedGeoAppliedValues = useMemo(
    () => buildEffectiveGeoFilters(appliedGeoSelection.selectedLocationKey, densityLocations, appliedGeoSelection.zoneIds, zoneOptions),
    [appliedGeoSelection.selectedLocationKey, appliedGeoSelection.zoneIds, densityLocations, zoneOptions]
  );
  const effectiveDraftFilters = useMemo(
    () => isFull
      ? buildFilterState({
          ...draftFilters,
          parentLocationKeys: draftGeoAppliedValues.parentLocationKeys,
          gridLocationKeys: draftGeoAppliedValues.gridLocationKeys,
        })
      : draftFilters,
    [draftFilters, draftGeoAppliedValues.gridLocationKeys, draftGeoAppliedValues.parentLocationKeys, isFull]
  );
  const selectedLocation = draftGeoSelection.selectedLocationKey
    ? densityLocations.find((location) => location.location_key === draftGeoSelection.selectedLocationKey) ?? null
    : null;
  const geoSelectionLabel = geoSelection?.label ?? (effectiveDraftFilters.gridLocationKeys.length > 0 || effectiveDraftFilters.parentLocationKeys.length > 0 ? "Zona geográfica" : "");
  const fullExplorerHref = useMemo(() => buildExplorerHref(effectiveDraftFilters), [effectiveDraftFilters]);
  const hasPendingChanges = serializeExplorerFilters(effectiveDraftFilters) !== serializeExplorerFilters(appliedFilters) || draftHeatMetric !== appliedHeatMetric;
  const appliedFilterCount = buildSelectedFilters(
    appliedFilters,
    appliedGeoAppliedValues.label,
    () => undefined,
    {
      setQ: () => undefined,
      setNiche: () => undefined,
      setSource: () => undefined,
      setTier: () => undefined,
      setMinScore: () => undefined,
      setPrimaryOffer: () => undefined,
      setCommercialOfferType: () => undefined,
      setSortValue: () => undefined,
    }
  ).length;
  const showLargeDatasetHint = isFull && total >= 500 && !hasMeaningfulFilters(appliedFilters);

  const selectedFilters = buildSelectedFilters(effectiveDraftFilters, isFull ? draftGeoAppliedValues.label : geoSelectionLabel, () => {
    if (isFull) {
      setDraftGeoSelection({ zoneIds: [], selectedLocationKey: null });
      return;
    }

    setDraftFilters((current) => buildFilterState({ ...current, parentLocationKeys: [], gridLocationKeys: [] }));
    onGeoSelectionClear?.();
  }, {
    setQ: () => setDraftFilters((current) => buildFilterState({ ...current, q: "" })),
    setNiche: () => setDraftFilters((current) => buildFilterState({ ...current, niche: "" })),
    setSource: () => setDraftFilters((current) => buildFilterState({ ...current, source: "" })),
    setTier: () => setDraftFilters((current) => buildFilterState({ ...current, tier: "" })),
    setMinScore: () => setDraftFilters((current) => buildFilterState({ ...current, minScore: "" })),
    setPrimaryOffer: () => setDraftFilters((current) => buildFilterState({ ...current, primaryOffer: "" })),
    setCommercialOfferType: () => setDraftFilters((current) => buildFilterState({ ...current, commercialOfferType: "" })),
    setSortValue: () => setDraftFilters((current) => buildFilterState({ ...current, sortValue: DEFAULT_SORT })),
  });

  const resetToFirstPage = useCallback(() => {
    setPageCursors([null]);
    setPageIndex(0);
  }, []);

  const updateUrl = useCallback(
    (filters: ExplorerFilterState, cursor: string | null) => {
      if (!isFull) return;

      const params = new URLSearchParams();
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.niche.trim()) params.set("niche", filters.niche.trim());
      if (filters.source) params.set("source", filters.source);
      if (filters.tier) params.set("contact_tier", filters.tier);
      if (filters.minScore.trim()) params.set("prospect_score_gte", filters.minScore.trim());
      if (filters.primaryOffer.trim()) params.set("primary_offer", filters.primaryOffer.trim());
      if (filters.commercialOfferType) params.set("commercial_offer_type", filters.commercialOfferType);
      if (filters.parentLocationKeys.length > 0) params.set("parent_location_keys", filters.parentLocationKeys.join(","));
      if (filters.gridLocationKeys.length > 0) params.set("grid_location_keys", filters.gridLocationKeys.join(","));
      if (filters.sortValue !== DEFAULT_SORT) {
        const sort = parseSortValue(filters.sortValue);
        params.set("sort_by", sort.sort_by);
        params.set("sort_direction", sort.sort_direction);
      }
      if (cursor) params.set("cursor", cursor);

      const nextUrl = params.toString() ? pathname + "?" + params.toString() : pathname;
      latestUrlRef.current = nextUrl;
      router.replace(nextUrl, { scroll: false });
    },
    [isFull, pathname, router]
  );

  const load = useCallback(
    async (filters: ExplorerFilterState, cursor: string | null, phase: Exclude<LoadingPhase, null>) => {
      if (!token) return;
      setLoadingPhase(phase);
      setError(null);

      try {
        const response = await listLeads(token, {
          q: filters.q.trim() || undefined,
          niche: filters.niche.trim() || undefined,
          source: filters.source || undefined,
          contact_tier: filters.tier || undefined,
          prospect_score_gte: filters.minScore.trim() ? Number(filters.minScore.trim()) : undefined,
          primary_offer: filters.primaryOffer.trim() || undefined,
          commercial_offer_type: filters.commercialOfferType || undefined,
          parent_location_keys: filters.parentLocationKeys.length > 0 ? filters.parentLocationKeys : undefined,
          grid_location_keys: filters.gridLocationKeys.length > 0 ? filters.gridLocationKeys : undefined,
          sort_by: parseSortValue(filters.sortValue).sort_by,
          sort_direction: parseSortValue(filters.sortValue).sort_direction,
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
    [effectivePageSize, token]
  );

  useEffect(() => {
    if (!isFull) return;
    const currentUrl = searchParams.toString() ? pathname + "?" + searchParams.toString() : pathname;
    if (latestUrlRef.current === currentUrl) return;

    const nextFilters = buildFilterState({
      q: readSearchParam(searchParams, "q"),
      niche: readSearchParam(searchParams, "niche"),
      source: readSearchParam(searchParams, "source"),
      tier: readSearchParam(searchParams, "contact_tier"),
      minScore: readSearchParam(searchParams, "prospect_score_gte"),
      primaryOffer: readSearchParam(searchParams, "primary_offer"),
      commercialOfferType: readSearchParam(searchParams, "commercial_offer_type") as CommercialOfferType | "",
      parentLocationKeys: readCsvSearchParam(searchParams, "parent_location_keys"),
      gridLocationKeys: readCsvSearchParam(searchParams, "grid_location_keys"),
      sortValue: (readSearchParam(searchParams, "sort_by") || "created_at") + ":" + (readSearchParam(searchParams, "sort_direction") || "desc"),
    });

    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setDraftHeatMetric("mixed");
    setAppliedHeatMetric("mixed");
    setDraftGeoSelection({
      zoneIds: zoneIdsFromFilters(nextFilters),
      selectedLocationKey: selectedLocationKeyFromFilters(nextFilters),
    });
    setAppliedGeoSelection({
      zoneIds: zoneIdsFromFilters(nextFilters),
      selectedLocationKey: selectedLocationKeyFromFilters(nextFilters),
    });
    setPageCursors([searchParams.get("cursor")]);
    setPageIndex(0);
  }, [isFull, pathname, searchParams]);

  useEffect(() => {
    if (isFull) return;
    const nextFilters = buildFilterState({
      ...draftFilters,
      parentLocationKeys: geoSelection?.parent_location_keys ?? [],
      gridLocationKeys: geoSelection?.grid_location_keys ?? [],
    });
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setDraftHeatMetric("mixed");
    setAppliedHeatMetric("mixed");
    resetToFirstPage();
  }, [geoSelection?.grid_location_keys, geoSelection?.parent_location_keys, isFull, resetToFirstPage]);

  useEffect(() => {
    updateUrl(appliedFilters, currentCursor);
  }, [appliedFilters, currentCursor, updateUrl]);

  useEffect(() => {
    if (!token) return;

    const filterKey = serializeExplorerFilters(appliedFilters);
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

    void load(appliedFilters, currentCursor, phase);
  }, [appliedFilters, currentCursor, load, token]);

  useEffect(() => {
    if (!token || !isFull) return;

    const filterKey = JSON.stringify(appliedDensityFilters);
    const filtersChanged = previousDensityFilterKey.current !== filterKey;
    previousDensityFilterKey.current = filterKey;
    setDensityLoading(true);
    const timeout = window.setTimeout(() => {
      getLeadDensity(token, { ...appliedDensityFilters, ...mapViewport })
        .then((res) => {
          setDensityLocations(res.data.locations);
          setDensityMeta(res.data.meta);
          setViewportLeads(res.data.viewport_leads ?? []);
          setDensityError(null);
          setDraftGeoSelection((current) => ({
            ...current,
            selectedLocationKey: res.data.locations.some((location) => location.location_key === current.selectedLocationKey)
              ? current.selectedLocationKey
              : null,
          }));
          setAppliedGeoSelection((current) => ({
            ...current,
            selectedLocationKey: res.data.locations.some((location) => location.location_key === current.selectedLocationKey)
              ? current.selectedLocationKey
              : null,
          }));
        })
        .catch((err) => {
          setDensityLocations([]);
          setDensityMeta(null);
          setViewportLeads([]);
          setDensityError(err instanceof Error ? err.message : "No se pudo cargar el mapa de leads.");
          setDraftGeoSelection((current) => ({ ...current, selectedLocationKey: null }));
        })
        .finally(() => setDensityLoading(false));
    }, filtersChanged ? 0 : 180);

    return () => {
      window.clearTimeout(timeout);
      setDensityLoading(false);
    };
  }, [appliedDensityFilters, isFull, mapViewport, token]);

  useEffect(() => {
    if (!token || !isFull) return;
    void listNicheAliasGroups(token)
      .then((response) => setNicheGroups(response.data))
      .catch(() => setNicheGroups([]));
  }, [isFull, token]);

  useEffect(() => {
    if (!token || !isFull) return;
    setZoneOptionsLoading(true);
    const timeout = window.setTimeout(() => {
      void listGeoZones(token, { q: zoneSearch || undefined, limit: 60 })
        .then((response) => {
          setZoneOptions(response.data);
          setZoneOptionsError(null);
        })
        .catch((err) => {
          setZoneOptions([]);
          setZoneOptionsError(err instanceof Error ? err.message : "No se pudieron cargar las zonas.");
        })
        .finally(() => setZoneOptionsLoading(false));
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      setZoneOptionsLoading(false);
    };
  }, [isFull, token, zoneSearch]);

  useEffect(() => {
    if (!token || !isFull || !selectedLocation) {
      setZoneLeads(null);
      setZoneLeadsTotal(0);
      return;
    }

    setZoneLeads([]);
    setZoneLeadsTotal(0);
    setZoneLeadsLoading(true);
    void getZoneLeads(token, { ...buildZoneLeadRequest(selectedLocation), ...appliedDensityFilters })
      .then((response) => {
        setZoneLeads(response.data);
        setZoneLeadsTotal(response.total);
        setZoneLeadsError(null);
      })
      .catch((err) => {
        setZoneLeads([]);
        setZoneLeadsTotal(0);
        setZoneLeadsError(err instanceof Error ? err.message : "No se pudieron cargar los leads de la zona seleccionada.");
      })
      .finally(() => setZoneLeadsLoading(false));
  }, [appliedDensityFilters, isFull, selectedLocation, token]);

  const applyFilters = useCallback(() => {
    const nextAppliedFilters = isFull
      ? buildFilterState({
          ...draftFilters,
          parentLocationKeys: draftGeoAppliedValues.parentLocationKeys,
          gridLocationKeys: draftGeoAppliedValues.gridLocationKeys,
        })
      : effectiveDraftFilters;

    setAppliedFilters(nextAppliedFilters);
    setAppliedHeatMetric(draftHeatMetric);
    if (isFull) {
      setAppliedGeoSelection({ ...draftGeoSelection });
    }
    resetToFirstPage();
  }, [draftFilters, draftGeoAppliedValues.gridLocationKeys, draftGeoAppliedValues.parentLocationKeys, draftGeoSelection, effectiveDraftFilters, isFull, resetToFirstPage]);

  const clearAllFilters = useCallback(() => {
    const empty = createEmptyFilterState();
    setDraftFilters(empty);
    setAppliedFilters(empty);
    setDraftHeatMetric("mixed");
    setAppliedHeatMetric("mixed");
    if (isFull) {
      setDraftGeoSelection({ zoneIds: [], selectedLocationKey: null });
      setAppliedGeoSelection({ zoneIds: [], selectedLocationKey: null });
      setZoneSearch("");
      setZoneLeads(null);
      setZoneLeadsTotal(0);
    } else {
      onGeoSelectionClear?.();
    }
    resetToFirstPage();
  }, [isFull, onGeoSelectionClear, resetToFirstPage]);

  function applyPreset(presetId: string) {
    const preset = PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    const values = preset.apply() as Partial<{ minScore: string; tier: string; source: string; commercialOfferType: CommercialOfferType; sortValue: string }>;
    setDraftFilters((current) => buildFilterState({
      ...current,
      minScore: values.minScore ?? current.minScore,
      tier: values.tier ?? current.tier,
      source: values.source ?? current.source,
      commercialOfferType: values.commercialOfferType ?? current.commercialOfferType,
      sortValue: values.sortValue ?? current.sortValue,
    }));
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
      <div className={cn("grid gap-3", isFull ? "xl:grid-cols-[1.4fr,1fr,1fr,1fr,1fr]" : "md:grid-cols-2 xl:grid-cols-5")}>
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar
            <HelpTip label="Buscar">Busca por nombre, dirección o nicho. Ideal para volver a un lead conocido o barrer un segmento concreto.</HelpTip>
          </div>
          <input
            type="search"
            placeholder="Nombre, dirección o niche"
            value={draftFilters.q}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, q: event.target.value }))}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Niche</div>
          <input
            type="text"
            placeholder="Ej: restaurante"
            value={draftFilters.niche}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, niche: event.target.value }))}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Oferta sugerida</div>
          <input
            type="text"
            placeholder="Ej: sitio_web"
            value={draftFilters.primaryOffer}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, primaryOffer: event.target.value }))}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo de oferta comercial</div>
          <select
            aria-label="Tipo de oferta comercial"
            value={draftFilters.commercialOfferType}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, commercialOfferType: event.target.value as CommercialOfferType | "" }))}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {COMMERCIAL_OFFER_TYPE_OPTIONS.map((option) => (
              <option key={option.value || "all-commercial"} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ordenar por</div>
          <select
            aria-label="Ordenar por"
            value={draftFilters.sortValue}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, sortValue: event.target.value }))}
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
            value={draftFilters.minScore}
            onChange={(event) => setDraftFilters((current) => buildFilterState({ ...current, minScore: event.target.value }))}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <div className="mt-2">
            <FilterChip
              label={`🔥 Solo hot leads (${HOT_LEAD_THRESHOLD}+)`}
              active={draftFilters.minScore.trim() !== "" && Number(draftFilters.minScore) >= HOT_LEAD_THRESHOLD}
              onClick={() =>
                setDraftFilters((current) =>
                  buildFilterState({
                    ...current,
                    minScore:
                      current.minScore.trim() !== "" && Number(current.minScore) >= HOT_LEAD_THRESHOLD
                        ? ""
                        : String(HOT_LEAD_THRESHOLD),
                  })
                )
              }
            />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fuente</p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((option) => (
              <FilterChip key={option.value || "all-source"} label={option.label} active={draftFilters.source === option.value} onClick={() => setDraftFilters((current) => buildFilterState({ ...current, source: option.value }))} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tier de contacto</p>
          <div className="flex flex-wrap gap-2">
            {TIER_OPTIONS.map((option) => (
              <FilterChip key={option.value || "all-tier"} label={option.label} active={draftFilters.tier === option.value} onClick={() => setDraftFilters((current) => buildFilterState({ ...current, tier: option.value }))} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {selectedFilters.length > 0 ? hasPendingChanges ? selectedFilters.length + " filtros seleccionados · pendiente aplicar" : selectedFilters.length + " filtros aplicados" : "Sin filtros seleccionados"}
        </span>
        {hasPendingChanges ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">Cambios sin aplicar</span> : <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">Listado sincronizado</span>}
        {selectedFilters.map((filter) => (
          <ActiveFilterPill key={filter.key} label={filter.label} value={filter.value} onClear={filter.clear} />
        ))}
        {!isFull ? (
          <Link href={fullExplorerHref} className="ml-auto text-sm font-medium text-sky-700 hover:underline">
            Abrir versión completa
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-sm text-slate-500">
          {hasPendingChanges ? "Los cambios quedan en borrador hasta hacer click en Filtrar." : "El listado y la URL ya reflejan esta selección."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={clearAllFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            Limpiar
          </button>
          <button type="button" onClick={applyFilters} disabled={!hasPendingChanges} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50">
            Filtrar
          </button>
        </div>
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
      title={appliedFilterCount > 0 ? "No hay leads para esta combinación aplicada" : "Todavía no hay leads para explorar"}
      description={appliedFilterCount > 0 ? "Probá bajar el score mínimo, cambiar la fuente, ajustar el tipo comercial o volver a todos los tiers." : "Cuando entren registros, esta vista va a convertirse en la cola principal de trabajo."}
      action={appliedFilterCount > 0 ? <button type="button" onClick={clearAllFilters} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">Limpiar filtros</button> : undefined}
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
            <button type="button" onClick={() => void load(appliedFilters, currentCursor, hasLoadedOnceRef.current ? "refresh" : "initial")} className="font-medium underline underline-offset-2">
              Reintentar
            </button>
          </div>
        ) : null}
        <div className={EMBEDDED_LIST_VIEWPORT_CLASS}>
          {listContent}
        </div>
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          <span>{loading ? "Actualizando…" : total > 0 ? "Mostrando " + currentStart + "-" + currentEnd + " de " + total.toLocaleString("es-UY") + " leads" : "Sin resultados para mostrar"}</span>
          <Link href={fullExplorerHref} className="font-medium text-sky-700 hover:underline">
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

      <SectionCard title="Mapa" description="Zonas con mayor densidad de leads. Clic en un cluster o cuadrícula para filtrar el listado.">
        <LeadReviewMap
          locations={densityLocations}
          meta={densityMeta}
          loadError={densityError}
          selectedLocationKey={draftGeoSelection.selectedLocationKey}
          onSelect={(location) => setDraftGeoSelection((current) => ({ ...current, selectedLocationKey: location.location_key }))}
          filters={draftDensityFilters}
          onFiltersChange={(filters) => {
            setDraftGeoSelection((current) => ({ ...current, zoneIds: filters.zone_ids ?? [] }));
            if (filters.heat_metric) setDraftHeatMetric(filters.heat_metric);
          }}
          nicheSuggestions={[]}
          nicheGroups={nicheGroups}
          loading={densityLoading}
          zones={zoneOptions}
          zoneSearch={zoneSearch}
          onZoneSearchChange={setZoneSearch}
          zonesLoading={zoneOptionsLoading}
          zonesError={zoneOptionsError}
          zoneLeads={zoneLeads}
          viewportLeads={viewportLeads}
          onViewportChange={setMapViewport}
          zoneLeadsTotal={zoneLeadsTotal}
          zoneLeadsLoading={zoneLeadsLoading}
          zoneLeadsError={zoneLeadsError}
          pendingChanges={hasPendingChanges}
          pendingSelectionLabel={draftGeoAppliedValues.label || null}
          appliedSelectionLabel={appliedGeoAppliedValues.label || null}
          onClearSelection={() => setDraftGeoSelection({ zoneIds: [], selectedLocationKey: null })}
          filterPanelMode="geo-only"
          showSelectionActions={false}
          filterHint="La selección del mapa queda en borrador hasta hacer click en Filtrar en el panel principal."
        />
      </SectionCard>

      <SectionCard title="Filtros" description="Afiná la búsqueda según valor comercial, origen y preparación del contacto.">
        {filtersContent}
      </SectionCard>

      {showLargeDatasetHint ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Dataset grande. Empezá por una cola sugerida o filtrá por fuente, tier, score, oferta, tipo comercial o mapa para acelerar el barrido operativo.
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void load(appliedFilters, currentCursor, hasLoadedOnceRef.current ? "refresh" : "initial")} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </div>
      ) : null}

      <SectionCard
        title="Listado"
        description="Cada fila resume valor, contexto y próxima lectura del lead antes de abrir la ficha."
        actions={<span className="text-xs text-slate-500">{loading ? isPaging ? "Cambiando de bloque…" : isRefreshing ? "Actualizando…" : "Cargando…" : "Bloque " + (pageIndex + 1)}</span>}
      >
        {listContent}
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-slate-500">
          {loading ? isPaging ? "Cambiando de bloque…" : isRefreshing ? "Actualizando resultados…" : "Cargando…" : total > 0 ? "Mostrando " + currentStart + "-" + currentEnd + " de " + total.toLocaleString("es-UY") + " leads" : "Sin resultados para mostrar"}
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
