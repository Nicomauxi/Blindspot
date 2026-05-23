"use client";

import { cn } from "@/lib/utils";
import type { DiscoveryLocationDensity } from "@/lib/api";

function hashToUnit(value: string): number {
  let hash = 0;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = (hash * 31 + value.charCodeAt(idx)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function pointForLocation(locationKey: string) {
  const x = 12 + hashToUnit(`${locationKey}:x`) * 76;
  const y = 14 + hashToUnit(`${locationKey}:y`) * 72;
  return { x, y };
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
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_38%),linear-gradient(180deg,_#0f172a_0%,_#111827_48%,_#1e293b_100%)] p-4 text-white shadow-sm">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:28px_28px] opacity-40" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Densidad comercial</p>
            <p className="mt-2 max-w-md text-sm text-slate-200">
              La primera capa prioriza agregados por ubicación normalizada. Los puntos exactos quedan listos para reutilizarse más adelante en Leads.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-200">
            <div>{locations.length} ubicaciones</div>
            <div className="mt-1 text-slate-400">Score 0-100</div>
          </div>
        </div>

        <div className="relative mt-6 h-[320px] rounded-[28px] border border-white/10 bg-black/10 p-2 backdrop-blur-sm">
          {locations.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/15 text-sm text-slate-300">
              Sin densidad para mostrar.
            </div>
          ) : (
            <svg viewBox="0 0 100 100" className="h-full w-full">
              {locations.map((location) => {
                const point = pointForLocation(location.location_key);
                const radius = 3 + (location.commercial_density_score / 100) * 6;
                const active = selectedLocationKey === location.location_key;
                return (
                  <g key={location.location_key}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={radius + 3}
                      className={cn("fill-sky-300/15", active && "fill-amber-300/25")}
                    />
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      onClick={() => onSelect?.(location)}
                      className={cn(
                        "cursor-pointer fill-sky-400/80 stroke-white/70 stroke-[0.6] transition-all hover:fill-cyan-300",
                        active && "fill-amber-300 stroke-amber-100"
                      )}
                    />
                    <text
                      x={point.x}
                      y={point.y - radius - 2}
                      textAnchor="middle"
                      className="fill-slate-100 text-[3.4px] font-medium"
                    >
                      {location.location_label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {locations.map((location) => {
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
                </div>
                <div className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
                  {location.commercial_density_score}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
