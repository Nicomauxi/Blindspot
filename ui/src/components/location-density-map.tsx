"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type {
  DiscoveryLeadDensityFilters,
  DiscoveryLeadDensityGpsSource,
  DiscoveryLeadDensityMeta,
  DiscoveryMapDensityLocation,
} from "@/lib/api";
import {
  computeLocationCentroid,
  countLocationPoints,
  filterAndSortLocations,
  type LocationDensitySort,
} from "@/lib/location-density-map";
import { cn } from "@/lib/utils";

const DEFAULT_CENTER: [number, number] = [-32.5228, -55.7658];
const DEFAULT_ZOOM = 7;
const MAP_SOURCE_OPTIONS = ["yelu", "mintur", "osm", "google_places", "pedidosya"] as const;
const CONTACT_TIER_OPTIONS = ["A", "B", "C", "D", "X"] as const;
const GPS_SOURCE_OPTIONS: Array<{ value: DiscoveryLeadDensityGpsSource; label: string }> = [
  { value: "real", label: "Real" },
  { value: "google", label: "Google" },
  { value: "inferred", label: "Inferido" },
];

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

function toggleValue(current: string[] | undefined, value: string): string[] | undefined {
  const base = current ?? [];
  const next = base.includes(value) ? base.filter((item) => item !== value) : [...base, value];
  return next.length > 0 ? next : undefined;
}

function sourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

export function LocationDensityMap({
  locations,
  meta,
  selectedLocationKey,
  onSelect,
  filters,
  onFiltersChange,
  nicheSuggestions = [],
  loading = false,
}: {
  locations: DiscoveryMapDensityLocation[];
  meta?: DiscoveryLeadDensityMeta | null;
  selectedLocationKey?: string | null;
  onSelect?: (location: DiscoveryMapDensityLocation) => void;
  filters: DiscoveryLeadDensityFilters;
  onFiltersChange?: (filters: DiscoveryLeadDensityFilters) => void;
  nicheSuggestions?: string[];
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LocationDensitySort>("density");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const visibleLocations = useMemo(() => filterAndSortLocations(locations, search, sort), [locations, search, sort]);
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
  ].reduce((sum, value) => sum + value, 0);
  const nicheListId = "discovery-map-niche-suggestions";

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
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_38%),linear-gradient(180deg,_#0f172a_0%,_#111827_48%,_#1e293b_100%)] p-4 text-white shadow-sm">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:28px_28px] opacity-40" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Mapa comercial granular</p>
            <p className="mt-2 max-w-md text-sm text-slate-200">
              La capa combina GPS reales y geocoding de direcciones sin coordenadas para dibujar cuadrículas operativas más finas que la ubicación agregada original.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-200">
            <div>{visibleLocations.length} cuadrículas visibles</div>
            <div className="mt-1 text-slate-300">{filteredLeadCount} leads filtrados</div>
            <div className="mt-1 text-slate-400">{positionedLeadCount} leads posicionados</div>
            <div className="mt-1 text-slate-400">GPS {rawVisible} · geocodificados {geocodedVisible}</div>
            <div className="mt-1 text-slate-400">Score 0-100 · grilla ~{meta?.grid_cell_size_km ?? 2.2} km</div>
            {loading ? <div className="mt-1 text-amber-200">Actualizando filtros…</div> : null}
          </div>
        </div>

        <div className="relative mt-6 h-[360px] rounded-[28px] border border-white/10 bg-black/10 p-2 backdrop-blur-sm">
          {visibleLocations.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/15 text-sm text-slate-300">
              Sin densidad para mostrar.
            </div>
          ) : !mounted ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-white/10 bg-black/20 text-sm text-slate-300">
              Inicializando mapa geográfico...
            </div>
          ) : (
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              scrollWheelZoom={false}
              className="location-density-leaflet h-full w-full rounded-[24px]"
            >
              <TileLayer
                attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapViewport locations={visibleLocations} selectedLocationKey={selectedLocationKey} />
              {visibleLocations.map((location) => {
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
                      color: active ? "#fef3c7" : "#dbeafe",
                      fillColor: active ? "#f59e0b" : "#38bdf8",
                      fillOpacity: active ? 0.76 : 0.58,
                      weight: active ? 2.2 : 1.4,
                    }}
                    eventHandlers={{
                      click: () => onSelect?.(location),
                    }}
                  >
                    <Popup>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                        <p className="text-xs text-slate-600">Área base: {location.parent_location_label}</p>
                        <p className="text-xs text-slate-600">
                          {location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}
                        </p>
                        <p className="text-xs font-medium text-slate-700">
                          Densidad {location.commercial_density_score} · GPS {location.raw_gps_lead_count} · geocodificados {location.geocoded_lead_count}
                        </p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Filtros del heatmap</p>
              <p className="mt-1 text-xs text-slate-500">Debounce 300ms sobre API. Los filtros se aplican antes de agregar la grilla.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                {activeFilterCount} filtros activos
              </span>
              <button type="button" onClick={clearFilters} className="text-xs font-medium text-sky-700 hover:underline">
                Limpiar
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
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
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={filters.prospect_score_gte ?? 0}
                onChange={(event) => patchFilters({ prospect_score_gte: Number(event.target.value) || 0 })}
                className="w-full accent-sky-600"
              />
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
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Filtrar zona</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Montevideo, Pocitos, Maldonado..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Ordenar por</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as LocationDensitySort)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white"
              >
                <option value="density">Densidad</option>
                <option value="leads">Leads</option>
                <option value="hot">Hot leads</option>
                <option value="prospect">Prospect score</option>
              </select>
            </label>
          </div>
        </div>

        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {visibleLocations.map((location) => {
            const active = selectedLocationKey === location.location_key;
            return (
              <button
                key={location.location_key}
                type="button"
                onClick={() => onSelect?.(location)}
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                  active
                    ? "border-amber-300 bg-amber-50"
                    : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                    <p className="mt-1 text-xs text-slate-500">Área base: {location.parent_location_label}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-600">GPS {location.raw_gps_lead_count} · geocodificados {location.geocoded_lead_count}</p>
                  </div>
                  <div className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
                    {location.commercial_density_score}
                  </div>
                </div>
              </button>
            );
          })}
          {visibleLocations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No hay zonas que coincidan con el filtro actual.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
