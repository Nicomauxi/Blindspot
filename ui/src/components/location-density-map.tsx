"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { DiscoveryLocationDensity } from "@/lib/api";
import {
  computeLocationCentroid,
  countLocationPoints,
  filterAndSortLocations,
  type LocationDensitySort,
} from "@/lib/location-density-map";
import { cn } from "@/lib/utils";

const DEFAULT_CENTER: [number, number] = [-32.5228, -55.7658];
const DEFAULT_ZOOM = 7;

function MapViewport({
  locations,
  selectedLocationKey,
}: {
  locations: DiscoveryLocationDensity[];
  selectedLocationKey?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    const selected = locations.find((location) => location.location_key === selectedLocationKey);
    const selectedCenter = selected ? computeLocationCentroid(selected) : null;
    if (selectedCenter) {
      map.flyTo([selectedCenter.lat, selectedCenter.lng], Math.max(map.getZoom(), 11), { duration: 0.45 });
      return;
    }

    const boundsPoints = locations.flatMap((location) => location.gps_points.map((point) => [point.lat, point.lng] as [number, number]));
    if (boundsPoints.length > 0) {
      map.fitBounds(boundsPoints, { padding: [24, 24], maxZoom: 10 });
      return;
    }

    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }, [locations, map, selectedLocationKey]);

  return null;
}

export function LocationDensityMap({
  locations,
  selectedLocationKey,
  onSelect,
}: {
  locations: DiscoveryLocationDensity[];
  selectedLocationKey?: string | null;
  onSelect?: (location: DiscoveryLocationDensity) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LocationDensitySort>("density");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const visibleLocations = useMemo(() => filterAndSortLocations(locations, search, sort), [locations, search, sort]);
  const totalPoints = useMemo(() => visibleLocations.reduce((sum, location) => sum + countLocationPoints(location), 0), [visibleLocations]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_38%),linear-gradient(180deg,_#0f172a_0%,_#111827_48%,_#1e293b_100%)] p-4 text-white shadow-sm">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:28px_28px] opacity-40" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Densidad comercial</p>
            <p className="mt-2 max-w-md text-sm text-slate-200">
              La capa usa coordenadas reales agregadas por ubicación normalizada y centra el viewport sobre los puntos disponibles para priorizar contexto operativo.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-200">
            <div>{visibleLocations.length} ubicaciones visibles</div>
            <div className="mt-1 text-slate-300">{totalPoints} puntos exactos</div>
            <div className="mt-1 text-slate-400">Score 0-100</div>
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
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapViewport locations={visibleLocations} selectedLocationKey={selectedLocationKey} />
              {visibleLocations.map((location) => {
                const centroid = computeLocationCentroid(location);
                if (!centroid) return null;
                const radius = 8 + (location.commercial_density_score / 100) * 14;
                const active = selectedLocationKey === location.location_key;
                return (
                  <CircleMarker
                    key={location.location_key}
                    center={[centroid.lat, centroid.lng]}
                    radius={radius}
                    pathOptions={{
                      color: active ? "#fef3c7" : "#dbeafe",
                      fillColor: active ? "#f59e0b" : "#38bdf8",
                      fillOpacity: active ? 0.72 : 0.56,
                      weight: active ? 2.2 : 1.4,
                    }}
                    eventHandlers={{
                      click: () => onSelect?.(location),
                    }}
                  >
                    <Popup>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                        <p className="text-xs text-slate-600">
                          {location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}
                        </p>
                        <p className="text-xs font-medium text-slate-700">
                          Densidad {location.commercial_density_score} · {countLocationPoints(location)} puntos exactos
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
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),180px]">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Filtrar ubicación</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Montevideo, Maldonado, Canelones..."
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
                    <p className="mt-1 text-xs text-slate-500">
                      {location.lead_count} leads · {location.hot_leads_count} hot · promedio {location.avg_prospect_score.toFixed(1)}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-600">{countLocationPoints(location)} puntos exactos georreferenciados</p>
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
              No hay ubicaciones que coincidan con el filtro actual.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
