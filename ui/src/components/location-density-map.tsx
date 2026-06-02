"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type {
  DiscoveryGeoZone,
  DiscoveryLeadDensityFilters,
  DiscoveryLeadDensityGpsSource,
  DiscoveryLeadDensityMeta,
  DiscoveryMapDensityLocation,
  NicheAliasGroup,
  ZoneLead,
} from "@/lib/api";
import {
  NICHE_MARKER_ICON_OPTIONS,
  buildNichePreferenceKey,
  computeLocationCentroid,
  countLocationPoints,
  filterAndSortLocations,
  formatLeadLabel,
  getNicheMarkerOption,
  resolveCanonicalNiche,
  resolveLeadMarkerIcon,
  type LocationDensityMapVariant,
  type LocationDensitySort,
  type NicheMarkerIconKey,
  type NicheMarkerIconOption,
} from "@/lib/location-density-map";
import { cn } from "@/lib/utils";

const DEFAULT_CENTER: [number, number] = [-32.5228, -55.7658];
const DEFAULT_ZOOM = 7;
const ICON_PREFERENCES_STORAGE_KEY = "blindspot-map-niche-icon-preferences";
const MAP_SOURCE_OPTIONS = ["yelu", "mintur", "osm", "google_places", "pedidosya"] as const;
const CONTACT_TIER_OPTIONS = ["A", "B", "C", "D", "X"] as const;
const GPS_SOURCE_OPTIONS: Array<{ value: DiscoveryLeadDensityGpsSource; label: string }> = [
  { value: "real", label: "Real" },
  { value: "google", label: "Google" },
  { value: "inferred", label: "Inferido" },
];

const TIER_COLORS: Record<string, { color: string; fillColor: string }> = {
  A: { color: "#6ee7b7", fillColor: "#10b981" },
  B: { color: "#7dd3fc", fillColor: "#0ea5e9" },
  C: { color: "#fcd34d", fillColor: "#f59e0b" },
  D: { color: "#94a3b8", fillColor: "#64748b" },
  X: { color: "#fca5a5", fillColor: "#ef4444" },
};

const TIER_BADGE_CLASSES: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-sky-100 text-sky-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-slate-100 text-slate-600",
  X: "bg-rose-100 text-rose-700",
};

const VARIANT_COPY: Record<LocationDensityMapVariant, {
  eyebrow: string;
  description: string;
  summary: string;
  filterTitle: string;
}> = {
  "lead-review": {
    eyebrow: "Mapa de leads",
    description: "Base cartográfica compartida con Discovery. Acá la selección delimita el universo comercial que trabajás en Inicio.",
    summary: "La misma infraestructura cartográfica que Discovery, orientada a revisión comercial sin abrir otra pantalla.",
    filterTitle: "Filtros del mapa",
  },
  "discovery-context": {
    eyebrow: "Mapa comercial granular",
    description: "La capa combina GPS reales y geocoding de direcciones sin coordenadas para dibujar cuadrículas operativas más finas que la ubicación agregada original.",
    summary: "La misma infraestructura cartográfica que Inicio, orientada a cargar contexto geográfico y bajar la selección al Composer.",
    filterTitle: "Filtros del mapa",
  },
};

function extractGpsPoint(gps: unknown, mapPoint?: { lat: number; lng: number } | null): { lat: number; lng: number } | null {
  if (mapPoint && Number.isFinite(mapPoint.lat) && Number.isFinite(mapPoint.lng)) {
    return mapPoint;
  }
  if (!gps || typeof gps !== "object") return null;
  const obj = gps as Record<string, unknown>;
  if (typeof obj["lat"] === "number" && typeof obj["lng"] === "number") {
    return { lat: obj["lat"], lng: obj["lng"] };
  }
  return null;
}

function sourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

function buildZoneHierarchyLabel(zone: DiscoveryGeoZone): string {
  const parts = [zone.departamento, zone.ciudad, zone.barrio].filter(Boolean);
  if (parts.length === 0) return zone.label;
  const hierarchy = parts.join(" > ");
  return hierarchy === zone.label ? hierarchy : [hierarchy, zone.label].join(" > ");
}

function toggleValue(current: string[] | undefined, value: string): string[] | undefined {
  const base = current ?? [];
  const next = base.includes(value) ? base.filter((item) => item !== value) : [...base, value];
  return next.length > 0 ? next : undefined;
}

function classifyOfferType(primaryOffer: string | null | undefined): "software" | "marketing" | "unknown" {
  const normalized = (primaryOffer ?? "").toLocaleLowerCase("es-UY");
  if (!normalized) return "unknown";
  if (["marketing", "ads", "redes", "social", "campana"].some((term) => normalized.includes(term))) return "marketing";
  if (["software", "pos", "web", "catalogo", "crm", "erp"].some((term) => normalized.includes(term))) return "software";
  return "unknown";
}

function hasSocialSignal(lead: ZoneLead): boolean {
  return (lead.tags ?? []).some((tag) => {
    const normalized = tag.toLocaleLowerCase("es-UY");
    return normalized.includes("instagram") || normalized.includes("facebook") || normalized.includes("social");
  });
}

function hasContactSignal(lead: ZoneLead): boolean {
  return Boolean(lead.phone || lead.whatsapp || lead.email);
}

function signalClass(active: boolean): string {
  return active
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-500";
}

function buildLeadMarkerDivIcon(leaflet: typeof import("leaflet"), option: NicheMarkerIconOption) {
  return leaflet.divIcon({
    className: "",
    html: `<div class="flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-sm ${option.markerClassName}"><span style="font-size:16px;line-height:1">${option.emoji}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
    tooltipAnchor: [0, -18],
  });
}

function LeadSignal({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2", signalClass(active))}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-1 text-xs font-medium">{value}</div>
    </div>
  );
}

function LeadIconSelector({
  lead,
  currentIconKey,
  nicheGroups,
  onChange,
}: {
  lead: ZoneLead;
  currentIconKey: NicheMarkerIconKey;
  nicheGroups: NicheAliasGroup[];
  onChange: (iconKey: NicheMarkerIconKey) => void;
}) {
  const canonicalNiche = resolveCanonicalNiche(lead.niche, nicheGroups) ?? "Sin nicho";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Icono del nicho</div>
          <p className="mt-1 text-xs text-slate-500">Este icono se usará para leads de {formatLeadLabel(canonicalNiche)}.</p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
          {getNicheMarkerOption(currentIconKey).label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-3">
        {NICHE_MARKER_ICON_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            data-testid="zone-lead-icon-option"
            data-icon-key={option.key}
            aria-label={option.label}
            className={cn(
              "rounded-xl border px-2 py-2 text-left transition-colors",
              option.key === currentIconKey ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300"
            )}
          >
            <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full border text-base", option.markerClassName)}>
              {option.emoji}
            </div>
            <div className="mt-2 text-[11px] font-medium text-slate-700">{option.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LeadReviewCard({
  lead,
  iconOption,
  nicheGroups,
  allowIconEditing,
  onIconChange,
}: {
  lead: ZoneLead;
  iconOption: NicheMarkerIconOption;
  nicheGroups: NicheAliasGroup[];
  allowIconEditing: boolean;
  onIconChange: (iconKey: NicheMarkerIconKey) => void;
}) {
  const tier = lead.contact_tier?.toUpperCase() ?? "D";
  const tierBadgeClass = TIER_BADGE_CLASSES[tier] ?? TIER_BADGE_CLASSES.D;
  const score = lead.prospect_score ?? 0;
  const scoreTone = score >= 75 ? "text-emerald-700" : score >= 55 ? "text-amber-700" : "text-slate-600";
  const offerType = classifyOfferType(lead.primary_offer);
  const canonicalNiche = resolveCanonicalNiche(lead.niche, nicheGroups);

  return (
    <div data-testid="zone-lead-card" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div data-testid="zone-lead-icon-preview" data-icon-key={iconOption.key} className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xl shadow-sm", iconOption.markerClassName)}>
          {iconOption.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{formatLeadLabel(lead.name ?? "Sin nombre")}</h3>
            {lead.contact_tier ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tierBadgeClass)}>Tier {lead.contact_tier}</span> : null}
            {lead.source ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{formatLeadLabel(sourceLabel(lead.source))}</span> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">{lead.address ?? "Sin dirección confirmada"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">{formatLeadLabel(canonicalNiche ?? lead.niche ?? "General")}</span>
            {lead.primary_offer ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{formatLeadLabel(lead.primary_offer.replaceAll("_", " "))}</span> : null}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-semibold", scoreTone)}>{lead.prospect_score ?? "—"}</div>
          <div className="text-[11px] text-slate-500">score comercial</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Lectura rápida</div>
        <p className="mt-2 text-sm text-slate-700">{lead.pitch_hook ?? "Sin pitch hook visible; conviene abrir la ficha antes de contactar."}</p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <LeadSignal label="Web" value={lead.website ? "Sitio detectado" : "Sin sitio confirmado"} active={Boolean(lead.website)} />
        <LeadSignal label="Social" value={hasSocialSignal(lead) ? "Señales sociales" : "Sin señal social"} active={hasSocialSignal(lead)} />
        <LeadSignal label="Contacto" value={hasContactSignal(lead) ? "Listo para salida" : "Falta validar"} active={hasContactSignal(lead)} />
        <LeadSignal label="Reviews" value={lead.review_count ? `${lead.review_count} reseñas` : "Sin reseñas"} active={(lead.review_count ?? 0) > 0 || (lead.rating ?? 0) > 0} />
        <LeadSignal label="Software" value={offerType === "software" ? "Oferta alineada" : "Sin señal clara"} active={offerType === "software"} />
        <LeadSignal label="Marketing" value={offerType === "marketing" ? "Oferta alineada" : "Sin señal clara"} active={offerType === "marketing"} />
      </div>

      {allowIconEditing ? (
        <div className="mt-4">
          <LeadIconSelector lead={lead} currentIconKey={iconOption.key} nicheGroups={nicheGroups} onChange={onIconChange} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
          {lead.website ? <span className="rounded-full bg-slate-100 px-2 py-1">Website</span> : null}
          {lead.phone ? <span className="rounded-full bg-slate-100 px-2 py-1">Teléfono</span> : null}
          {lead.whatsapp ? <span className="rounded-full bg-slate-100 px-2 py-1">WhatsApp</span> : null}
          {lead.email ? <span className="rounded-full bg-slate-100 px-2 py-1">Email</span> : null}
          {lead.contact_ready ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Contacto listo</span> : null}
          {lead.rating ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">Rating {lead.rating.toFixed(1)}</span> : null}
        </div>
        <a href={`/admin/leads/${lead.id}`} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100">
          Abrir ficha
        </a>
      </div>
    </div>
  );
}

function MapViewport({
  locations,
  selectedLocationKey,
}: {
  locations: DiscoveryMapDensityLocation[];
  selectedLocationKey?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    const selected = locations.find((location) => location.location_key === selectedLocationKey);
    const selectedCenter = selected ? computeLocationCentroid(selected) : null;
    if (selectedCenter) {
      map.flyTo([selectedCenter.lat, selectedCenter.lng], Math.max(map.getZoom(), 12), { duration: 0.45 });
      return;
    }

    const boundsPoints = locations.flatMap((location) => location.gps_points.map((point) => [point.lat, point.lng] as [number, number]));
    if (boundsPoints.length > 0) {
      map.fitBounds(boundsPoints, { padding: [24, 24], maxZoom: 11 });
      return;
    }

    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }, [locations, map, selectedLocationKey]);

  return null;
}

export type LocationDensityMapBaseProps = {
  variant: LocationDensityMapVariant;
  locations: DiscoveryMapDensityLocation[];
  meta?: DiscoveryLeadDensityMeta | null;
  loadError?: string | null;
  selectedLocationKey?: string | null;
  onSelect?: (location: DiscoveryMapDensityLocation) => void;
  onSelectWithDrill?: (location: DiscoveryMapDensityLocation) => void;
  filters: DiscoveryLeadDensityFilters;
  onFiltersChange?: (filters: DiscoveryLeadDensityFilters) => void;
  nicheSuggestions?: string[];
  nicheGroups?: NicheAliasGroup[];
  allowIconEditing?: boolean;
  loading?: boolean;
  zones?: DiscoveryGeoZone[];
  zoneSearch?: string;
  onZoneSearchChange?: (value: string) => void;
  zonesLoading?: boolean;
  zonesError?: string | null;
  zoneLeads?: ZoneLead[] | null;
  zoneLeadsTotal?: number;
  zoneLeadsLoading?: boolean;
  zoneLeadsError?: string | null;
  pendingChanges?: boolean;
  pendingSelectionLabel?: string | null;
  appliedSelectionLabel?: string | null;
  onApplySelection?: () => void;
  onCancelSelection?: () => void;
  onClearSelection?: () => void;
  filterPanelMode?: "full" | "geo-only";
  showSelectionActions?: boolean;
  filterHint?: string;
};

export function LocationDensityMapBase({
  variant,
  locations,
  meta,
  loadError = null,
  selectedLocationKey,
  onSelect,
  onSelectWithDrill,
  filters,
  onFiltersChange,
  nicheSuggestions = [],
  nicheGroups = [],
  allowIconEditing = false,
  loading = false,
  zones = [],
  zoneSearch = "",
  onZoneSearchChange,
  zonesLoading = false,
  zonesError = null,
  zoneLeads,
  zoneLeadsTotal,
  zoneLeadsLoading,
  zoneLeadsError = null,
  pendingChanges = false,
  pendingSelectionLabel = null,
  appliedSelectionLabel = null,
  onApplySelection,
  onCancelSelection,
  onClearSelection,
  filterPanelMode = "full",
  showSelectionActions = variant === "lead-review",
  filterHint = variant === "lead-review"
    ? "Los cambios quedan en borrador hasta aplicar la selección."
    : "Debounce 300ms sobre API. Los filtros se aplican antes de agregar la grilla.",
}: LocationDensityMapBaseProps) {
  const [sort, setSort] = useState<LocationDensitySort>("density");
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"heatmap" | "individual">("heatmap");
  const [iconPreferences, setIconPreferences] = useState<Record<string, NicheMarkerIconKey>>({});
  const [leafletModule, setLeafletModule] = useState<null | typeof import("leaflet")>(null);
  const copy = VARIANT_COPY[variant];

  useEffect(() => {
    setMounted(true);
    try {
      const raw = window.localStorage.getItem(ICON_PREFERENCES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, NicheMarkerIconKey>;
      setIconPreferences(parsed);
    } catch {
      setIconPreferences({});
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(ICON_PREFERENCES_STORAGE_KEY, JSON.stringify(iconPreferences));
  }, [iconPreferences, mounted]);

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    void import("leaflet").then((module) => {
      if (active) setLeafletModule(module);
    }).catch(() => setLeafletModule(null));
    return () => {
      active = false;
    };
  }, [mounted]);

  const visibleLocations = useMemo(() => filterAndSortLocations(locations, "", sort), [locations, sort]);
  const totalPoints = useMemo(() => visibleLocations.reduce((sum, location) => sum + countLocationPoints(location), 0), [visibleLocations]);
  const geocodedVisible = useMemo(() => visibleLocations.reduce((sum, location) => sum + location.geocoded_lead_count, 0), [visibleLocations]);
  const rawVisible = useMemo(() => visibleLocations.reduce((sum, location) => sum + location.raw_gps_lead_count, 0), [visibleLocations]);
  const filteredLeadCount = meta?.filtered_leads ?? locations.reduce((sum, location) => sum + location.lead_count, 0);
  const positionedLeadCount = meta?.positioned_leads ?? totalPoints;
  const unpositionedLeadCount = Math.max(filteredLeadCount - positionedLeadCount, 0);
  const activeFilterCount = [
    filters.source?.length ?? 0,
    filters.niche?.trim() ? 1 : 0,
    (filters.prospect_score_gte ?? 0) > 0 ? 1 : 0,
    filters.contact_tier?.length ?? 0,
    filters.gps_source?.length ?? 0,
    filters.zone_ids?.length ?? 0,
  ].reduce((sum, value) => sum + value, 0);
  const nicheListId = "discovery-map-niche-suggestions";
  const hasMore = (zoneLeadsTotal ?? 0) > (zoneLeads?.length ?? 0);
  const showLeadReviewSummary = variant === "lead-review";
  const showLeadReviewActions = showLeadReviewSummary && showSelectionActions;
  const selectedLocation = selectedLocationKey
    ? locations.find((location) => location.location_key === selectedLocationKey) ?? null
    : null;
  const draftSelectionLabel = pendingSelectionLabel ?? selectedLocation?.location_label ?? null;
  const individualLeads = zoneLeads ?? [];
  const leadIcons = useMemo(
    () => new Map(individualLeads.map((lead) => [lead.id, resolveLeadMarkerIcon(lead, nicheGroups, iconPreferences)])),
    [iconPreferences, individualLeads, nicheGroups]
  );

  function patchFilters(patch: Partial<DiscoveryLeadDensityFilters>) {
    onFiltersChange?.({
      ...filters,
      ...patch,
    });
  }

  function clearFilters() {
    onFiltersChange?.({
      location: filters.location,
      limit: filters.limit,
    });
    onZoneSearchChange?.("");
  }

  function toggleZone(zoneId: string) {
    patchFilters({ zone_ids: toggleValue(filters.zone_ids, zoneId) });
  }

  function handleHeatmapMarkerClick(location: DiscoveryMapDensityLocation) {
    onSelect?.(location);
    onSelectWithDrill?.(location);
    setMode("individual");
  }

  function handleListItemClick(location: DiscoveryMapDensityLocation) {
    if (mode === "heatmap") {
      onSelect?.(location);
      return;
    }
    onSelect?.(location);
    onSelectWithDrill?.(location);
  }

  function updateLeadIconPreference(lead: ZoneLead, iconKey: NicheMarkerIconKey) {
    const preferenceKey = buildNichePreferenceKey(lead.niche, nicheGroups);
    if (!preferenceKey) return;
    setIconPreferences((current) => ({ ...current, [preferenceKey]: iconKey }));
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_38%),linear-gradient(180deg,_#0f172a_0%,_#111827_48%,_#1e293b_100%)] p-4 text-white shadow-sm">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:28px_28px] opacity-40" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">{copy.eyebrow}</p>
            <p className="mt-2 max-w-md text-sm text-slate-200">{copy.description}</p>
            <p className="mt-2 max-w-md text-xs text-slate-300">{copy.summary}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-200">
              <div data-testid="location-density-visible-count">{visibleLocations.length} cuadrículas visibles</div>
              <div className="mt-1 text-slate-300">{filteredLeadCount} leads filtrados</div>
              <div className="mt-1 text-slate-400">{positionedLeadCount} leads posicionados</div>
              <div className="mt-1 text-slate-400">GPS {rawVisible} · geocodificados {geocodedVisible}</div>
              <div className="mt-1 text-slate-400">Score 0-100 · grilla ~{meta?.grid_cell_size_km ?? 2.2} km</div>
              {loading ? <div className="mt-1 text-amber-200">Actualizando filtros...</div> : null}
            </div>
            <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
              <button className={cn("rounded-full px-3 py-1 transition-colors", mode === "heatmap" ? "bg-sky-500 text-white" : "text-slate-300 hover:text-white")} onClick={() => setMode("heatmap")}>
                Mapa de calor
              </button>
              <button className={cn("rounded-full px-3 py-1 transition-colors", mode === "individual" ? "bg-sky-500 text-white" : "text-slate-300 hover:text-white")} onClick={() => setMode("individual")}>
                Leads individuales
              </button>
            </div>
          </div>
        </div>

        <div className="relative mt-6 h-[360px] rounded-[28px] border border-white/10 bg-black/10 p-2 backdrop-blur-sm">
          {loadError ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-rose-200 bg-rose-50/90 px-6 text-center text-sm text-rose-100">
              <div>
                <div className="font-semibold text-white">No se pudo cargar el mapa.</div>
                <div className="mt-1 text-slate-200">{loadError}</div>
              </div>
            </div>
          ) : mode === "heatmap" && visibleLocations.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/15 text-sm text-slate-300">
              Sin densidad para mostrar.
            </div>
          ) : mode === "individual" && !selectedLocationKey ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/15 text-sm text-slate-300">
              Selecciona una zona para ver los leads individuales.
            </div>
          ) : mode === "individual" && zoneLeadsLoading ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20 text-sm text-slate-300">
              Cargando leads...
            </div>
          ) : mode === "individual" && selectedLocationKey && individualLeads.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/15 px-6 text-center text-sm text-slate-300">
              No hay leads posicionables en esta cuadrícula con los filtros actuales.
            </div>
          ) : !mounted ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20 text-sm text-slate-300">
              Inicializando mapa geográfico...
            </div>
          ) : (
            <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom={false} className="location-density-leaflet h-full w-full rounded-[24px]" data-testid="location-density-map">
              <TileLayer attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapViewport locations={visibleLocations} selectedLocationKey={selectedLocationKey} />

              {mode === "heatmap" && visibleLocations.map((location) => {
                const centroid = computeLocationCentroid(location);
                if (!centroid) return null;
                const radius = 7 + (location.commercial_density_score / 100) * 15;
                const active = selectedLocationKey === location.location_key;
                return (
                  <CircleMarker
                    key={location.location_key}
                    center={[centroid.lat, centroid.lng]}
                    radius={radius}
                    pathOptions={{
                      className: "density-marker density-marker--heatmap",
                      color: active ? "#fef3c7" : "#dbeafe",
                      fillColor: active ? "#f59e0b" : "#38bdf8",
                      fillOpacity: active ? 0.76 : 0.58,
                      weight: active ? 2.2 : 1.4,
                    }}
                    eventHandlers={{ click: () => handleHeatmapMarkerClick(location) }}
                  >
                    <Popup>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                        <p className="text-xs text-slate-600">Área base: {location.parent_location_label}</p>
                        <p className="text-xs text-slate-600">{location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}</p>
                        <p className="text-xs font-medium text-slate-700">Densidad {location.commercial_density_score} · GPS {location.raw_gps_lead_count} · geocodificados {location.geocoded_lead_count}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {mode === "individual" && individualLeads.map((lead) => {
                const point = extractGpsPoint(lead.gps, lead.map_point ?? null);
                if (!point) return null;
                const iconOption = leadIcons.get(lead.id) ?? getNicheMarkerOption("default");
                return (
                  <Marker key={lead.id} position={[point.lat, point.lng]} icon={leafletModule ? buildLeadMarkerDivIcon(leafletModule, iconOption) : undefined}>
                    <Tooltip direction="top" opacity={0.95}>
                      {formatLeadLabel(lead.name ?? "Sin nombre")}
                    </Tooltip>
                    <Popup>
                      <div className="min-w-[200px] space-y-2">
                        <div className="flex items-start gap-2">
                          <div className={cn("flex h-9 w-9 items-center justify-center rounded-full border text-base", iconOption.markerClassName)}>{iconOption.emoji}</div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{formatLeadLabel(lead.name ?? "Sin nombre")}</p>
                            <p className="text-xs text-slate-500">{lead.address ?? "Sin dirección"}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {lead.niche ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{formatLeadLabel(lead.niche)}</span> : null}
                          {lead.contact_tier ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TIER_BADGE_CLASSES[lead.contact_tier] ?? TIER_BADGE_CLASSES.D)}>Tier {lead.contact_tier}</span> : null}
                          {lead.prospect_score != null ? <span className="text-xs text-slate-500">Score {lead.prospect_score}</span> : null}
                        </div>
                        <a href={`/admin/leads/${lead.id}`} className="block text-xs font-medium text-sky-600 hover:underline">Abrir ficha</a>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          )}

          {mode === "individual" && hasMore && !zoneLeadsLoading && individualLeads.length > 0 ? (
            <div className="absolute bottom-2 left-1/2 z-[1000] -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-1.5 text-xs text-slate-100 backdrop-blur-sm">
              Mostrando {individualLeads.length} de {zoneLeadsTotal} leads en esta cuadrícula.
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.filterTitle}</p>
              <p className="mt-1 text-xs text-slate-500">{filterHint}</p>
              {showLeadReviewSummary ? (
                <p className="mt-2 text-[11px] text-slate-500" data-testid="lead-review-map-selection-summary">
                  {pendingChanges
                    ? draftSelectionLabel
                      ? `Borrador: ${draftSelectionLabel}`
                      : "Borrador sin selección aplicada al listado"
                    : appliedSelectionLabel
                      ? `Aplicado al listado: ${appliedSelectionLabel}`
                      : "Sin selección aplicada al listado"}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{activeFilterCount} filtros activos</span>
              {showLeadReviewSummary ? (
                <>
                  <span data-testid="lead-review-map-pending-state" className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", pendingChanges ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                    {pendingChanges ? "Cambios sin aplicar" : "Listado sincronizado"}
                  </span>
                  {showLeadReviewActions ? (
                    <>
                      <button type="button" onClick={() => onApplySelection?.()} disabled={!pendingChanges} data-testid="lead-review-map-apply" className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50">
                        Aplicar al listado
                      </button>
                      <button type="button" onClick={() => onCancelSelection?.()} disabled={!pendingChanges} data-testid="lead-review-map-cancel" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                        Cancelar
                      </button>
                    </>
                  ) : null}
                  {onClearSelection ? (
                    <button
                      type="button"
                      onClick={() => onClearSelection()}
                      data-testid="lead-review-map-clear"
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Limpiar selección
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" onClick={clearFilters} className="text-xs font-medium text-sky-700 hover:underline">
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {filterPanelMode === "full" ? (
              <>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Fuente</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MAP_SOURCE_OPTIONS.map((source) => {
                      const active = filters.source?.includes(source) ?? false;
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() => patchFilters({ source: toggleValue(filters.source, source) })}
                          className={cn(
                            "rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            active ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          )}
                        >
                          {sourceLabel(source)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Niche</span>
                  <input
                    value={filters.niche ?? ""}
                    onChange={(event) => patchFilters({ niche: event.target.value || undefined })}
                    placeholder="restaurante, clínica, hotel..."
                    list={nicheListId}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white"
                  />
                  <datalist id={nicheListId}>
                    {nicheSuggestions.map((niche) => (
                      <option key={niche} value={niche} />
                    ))}
                  </datalist>
                </label>

                <label className="space-y-2">
                  <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <span>Prospect score mínimo</span>
                    <span className="text-slate-700">{filters.prospect_score_gte ?? 0}</span>
                  </span>
                  <input type="range" min={0} max={100} step={5} value={filters.prospect_score_gte ?? 0} onChange={(event) => patchFilters({ prospect_score_gte: Number(event.target.value) || 0 })} className="w-full accent-sky-600" />
                </label>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Contact tier</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CONTACT_TIER_OPTIONS.map((tier) => {
                      const active = filters.contact_tier?.includes(tier) ?? false;
                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => patchFilters({ contact_tier: toggleValue(filters.contact_tier, tier) })}
                          className={cn(
                            "rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            active ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          )}
                        >
                          {tier}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Origen GPS</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {GPS_SOURCE_OPTIONS.map((option) => {
                      const active = filters.gps_source?.includes(option.value) ?? false;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => patchFilters({ gps_source: toggleValue(filters.gps_source, option.value) as DiscoveryLeadDensityGpsSource[] | undefined })}
                          className={cn(
                            "rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            active ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                El mapa ya refleja fuente, nicho, score y tier del panel principal. Acá definís solo el recorte geográfico.
              </div>
            )}
          </div>

          {unpositionedLeadCount > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
              {unpositionedLeadCount} leads coinciden con los filtros pero no entran al mapa todavía porque no tienen GPS utilizable o la dirección no pudo resolverse.
            </div>
          ) : null}

          {meta ? (
            <div className="mt-4 grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-2">
              <div>GPS reales totales: <span className="font-semibold text-slate-900">{meta.raw_gps_leads}</span></div>
              <div>Direcciones geocodificadas: <span className="font-semibold text-slate-900">{meta.geocoded_address_leads}</span></div>
              <div>Direcciones sin resolver: <span className="font-semibold text-slate-900">{meta.unresolved_address_leads}</span></div>
              <div>Backlog por rate-limit: <span className="font-semibold text-slate-900">{meta.deferred_geocode_leads}</span></div>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),180px]">
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Filtrar zona</span>
              <input value={zoneSearch} onChange={(event) => onZoneSearchChange?.(event.target.value)} placeholder="Buscar zona registrada..." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white" />
              {filters.zone_ids && filters.zone_ids.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {filters.zone_ids.map((zoneId) => {
                    const zone = zones.find((entry) => entry.zone_id === zoneId);
                    return (
                      <button key={zoneId} type="button" onClick={() => toggleZone(zoneId)} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                        {zone?.label ?? zoneId}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1" data-testid="zone-filter-options">
                {zonesLoading ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">Buscando zonas...</div> : null}
                {!zonesLoading && zonesError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">{zonesError}</div> : null}
                {!zonesLoading && !zonesError && zones.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No hay zonas registradas para esta búsqueda.</div> : null}
                {!zonesLoading && !zonesError && zones.map((zone) => {
                  const active = filters.zone_ids?.includes(zone.zone_id) ?? false;
                  return (
                    <button
                      key={zone.zone_id}
                      type="button"
                      onClick={() => toggleZone(zone.zone_id)}
                      className={cn(
                        "w-full rounded-2xl border px-3 py-2 text-left transition-colors",
                        active ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{zone.label}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{zone.lead_count}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{buildZoneHierarchyLabel(zone)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Ordenar por</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as LocationDensitySort)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white">
                <option value="density">Densidad</option>
                <option value="leads">Leads</option>
                <option value="hot">Hot leads</option>
                <option value="prospect">Prospect score</option>
              </select>
            </label>
          </div>
        </div>

        {mode === "individual" && selectedLocationKey ? (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {zoneLeadsError ? (
              <div data-testid="location-density-zone-error" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
                {zoneLeadsError}
              </div>
            ) : zoneLeadsLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Cargando leads...</div>
            ) : individualLeads.length > 0 ? (
              individualLeads.map((lead) => {
                const iconOption = leadIcons.get(lead.id) ?? getNicheMarkerOption("default");
                return (
                  <LeadReviewCard
                    key={lead.id}
                    lead={lead}
                    iconOption={iconOption}
                    nicheGroups={nicheGroups}
                    allowIconEditing={allowIconEditing}
                    onIconChange={(iconKey) => updateLeadIconPreference(lead, iconKey)}
                  />
                );
              })
            ) : (
              <div data-testid="location-density-empty" className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No hay leads individuales para esta cuadrícula.
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {visibleLocations.map((location) => {
              const active = selectedLocationKey === location.location_key;
              return (
                <button
                  key={location.location_key}
                  type="button"
                  onClick={() => handleListItemClick(location)}
                  data-testid="location-density-list-item"
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                    active ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                      <p className="mt-1 text-xs text-slate-500">Área base: {location.parent_location_label}</p>
                      <p className="mt-1 text-xs text-slate-500">{location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}</p>
                      <p className="mt-2 text-xs font-medium text-slate-600">GPS {location.raw_gps_lead_count} · geocodificados {location.geocoded_lead_count}</p>
                    </div>
                    <div className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">{location.commercial_density_score}</div>
                  </div>
                </button>
              );
            })}
            {visibleLocations.length === 0 ? (
              <div data-testid="location-density-empty" className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No hay zonas que coincidan con el filtro actual.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
