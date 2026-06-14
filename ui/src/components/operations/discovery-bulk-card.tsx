"use client";

import type { Dispatch, SetStateAction } from "react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/admin-shell";
import { DiscoveryLocationPicker } from "@/components/discovery-location-picker";
import type { DiscoveryLocationSelection } from "@/lib/discovery-location";

const BULK_NICHES = ["restaurante", "hotel", "clínica", "ferretería", "supermercado", "farmacia", "peluquería", "taller", "panadería", "estudio contable"] as const;
const BULK_COST_WARNING_THRESHOLD = 5;

// Card presentacional de creación masiva de jobs Google Places. El estado y el
// cálculo de costos viven en DiscoveryOps (comparten estimadores con el Composer).
interface DiscoveryBulkCardProps {
  token: string | null;
  bulkLocations: DiscoveryLocationSelection[];
  setBulkLocations: (next: DiscoveryLocationSelection[]) => void;
  bulkNiches: string[];
  setBulkNiches: Dispatch<SetStateAction<string[]>>;
  bulkMaxResults: string;
  setBulkMaxResults: (value: string) => void;
  bulkCostCap: string;
  setBulkCostCap: (value: string) => void;
  bulkJobCount: number;
  bulkLocationsCount: number;
  bulkTotalCost: number;
  bulkConfirmPending: boolean;
  setBulkConfirmPending: (value: boolean) => void;
  bulkResult: string | null;
  bulkError: string | null;
  bulkCreating: boolean;
  onBulkCreate: () => void;
}

export function DiscoveryBulkCard({
  token,
  bulkLocations,
  setBulkLocations,
  bulkNiches,
  setBulkNiches,
  bulkMaxResults,
  setBulkMaxResults,
  bulkCostCap,
  setBulkCostCap,
  bulkJobCount,
  bulkLocationsCount,
  bulkTotalCost,
  bulkConfirmPending,
  setBulkConfirmPending,
  bulkResult,
  bulkError,
  bulkCreating,
  onBulkCreate,
}: DiscoveryBulkCardProps) {
  return (
    <SectionCard title="Creación masiva" description="Creá múltiples jobs Google Places de una sola vez combinando ubicaciones del catálogo × nichos.">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium theme-text-muted mb-2">Ubicaciones</p>
          <DiscoveryLocationPicker
            token={token}
            mode="multi"
            selected={bulkLocations}
            onChange={setBulkLocations}
            niche={bulkNiches[0]}
            enablePredictive
            testId="bulk-location"
          />
        </div>
        <div>
          <p className="text-xs font-medium theme-text-muted mb-2">Nichos</p>
          <div className="flex flex-wrap gap-1.5">
            {BULK_NICHES.map((niche) => (
              <button
                key={niche}
                type="button"
                onClick={() => setBulkNiches((prev) => prev.includes(niche) ? prev.filter((n) => n !== niche) : [...prev, niche])}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium border transition-colors", bulkNiches.includes(niche) ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100")}
              >
                {niche}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs theme-text-muted block mb-1">Max results / job</label>
            <input type="number" min={1} max={500} className="rounded-lg border px-2 py-1.5 text-sm theme-input w-28" value={bulkMaxResults} onChange={(e) => setBulkMaxResults(e.target.value)} />
          </div>
          <div>
            <label className="text-xs theme-text-muted block mb-1">Cost cap USD / job</label>
            <input type="number" min={0} step={0.5} className="rounded-lg border px-2 py-1.5 text-sm theme-input w-28" value={bulkCostCap} onChange={(e) => setBulkCostCap(e.target.value)} />
          </div>
          <div className="rounded-xl border px-3 py-2 text-xs theme-text-muted space-y-0.5">
            <p><span className="font-semibold theme-text-strong">{bulkJobCount}</span> jobs ({bulkLocationsCount} ubicaciones × {bulkNiches.length} nichos)</p>
            <p>Costo estimado: <span className={cn("font-semibold", bulkTotalCost > BULK_COST_WARNING_THRESHOLD ? "text-amber-600" : "theme-text-strong")}>USD {bulkTotalCost.toFixed(2)}</span></p>
          </div>
        </div>

        {bulkTotalCost > BULK_COST_WARNING_THRESHOLD && !bulkConfirmPending && bulkJobCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            El costo estimado supera USD {BULK_COST_WARNING_THRESHOLD}. Confirmá antes de crear.
          </div>
        )}

        {bulkJobCount === 0 && <p className="text-xs text-amber-700">Elegí al menos una ubicación y un nicho para crear el lote.</p>}
        {bulkResult && <p className="text-xs text-emerald-600">{bulkResult}</p>}
        {bulkError && <p className="text-xs text-rose-600">{bulkError}</p>}

        <div className="flex gap-2">
          {bulkTotalCost > BULK_COST_WARNING_THRESHOLD && !bulkConfirmPending ? (
            <button
              type="button"
              disabled={bulkJobCount === 0}
              onClick={() => setBulkConfirmPending(true)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              Confirmar creación ({bulkJobCount} jobs, ~USD {bulkTotalCost.toFixed(2)})
            </button>
          ) : (
            <button
              type="button"
              disabled={bulkJobCount === 0 || bulkCreating}
              onClick={onBulkCreate}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {bulkCreating ? "Creando…" : `Crear lote (${bulkJobCount} jobs)`}
            </button>
          )}
          {bulkConfirmPending && (
            <button type="button" className="rounded-lg px-4 py-2 text-sm theme-text-muted" onClick={() => setBulkConfirmPending(false)}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
