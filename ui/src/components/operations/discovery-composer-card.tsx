"use client";

import type { Dispatch, SetStateAction } from "react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/admin-shell";
import { DiscoveryLocationPicker } from "@/components/discovery-location-picker";
import type { DiscoveryComposerDraft } from "@/lib/discovery-workspace";
import type { DiscoveryLocationSelection } from "@/lib/discovery-location";

const SOURCES = ["yelu", "pedidosya", "mintur", "osm", "miem_dei", "google_places"] as const;
const PROFILES = ["A", "B", "C", "D"] as const;

function toggleSource(current: string[], source: string): string[] {
  return current.includes(source) ? current.filter((item) => item !== source) : [...current, source];
}

function PrefillBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={cn("rounded-full px-2 py-1 text-xs font-medium", active ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500")}>
      {label}
    </span>
  );
}

// Card presentacional del Composer de discovery. El estado vive en DiscoveryOps
// (el mapa y las recomendaciones lo prefillean), acá sólo se renderiza y se editan
// los campos vía los setters del padre.
interface DiscoveryComposerCardProps {
  token: string | null;
  composer: DiscoveryComposerDraft;
  setComposer: Dispatch<SetStateAction<DiscoveryComposerDraft>>;
  composerSelection: DiscoveryLocationSelection | null;
  setComposerSelection: Dispatch<SetStateAction<DiscoveryLocationSelection | null>>;
  setSelectedLocationKey: Dispatch<SetStateAction<string | null>>;
  prefillNote: string | null;
  setPrefillNote: Dispatch<SetStateAction<string | null>>;
  includesGoogle: boolean;
  estimatedGoogleCost: number;
  estimatedBatchCost: number;
  effectiveGoogleCap: number | null;
  effectiveComposerLocation: string;
  budgetSpent: number | null;
  remainingBudget: number | null;
  batchWarnings: string[];
  creating: boolean;
  onCreateBatch: () => void;
  onReset: () => void;
}

export function DiscoveryComposerCard({
  token,
  composer,
  setComposer,
  composerSelection,
  setComposerSelection,
  setSelectedLocationKey,
  prefillNote,
  setPrefillNote,
  includesGoogle,
  estimatedGoogleCost,
  estimatedBatchCost,
  effectiveGoogleCap,
  effectiveComposerLocation,
  budgetSpent,
  remainingBudget,
  batchWarnings,
  creating,
  onCreateBatch,
  onReset,
}: DiscoveryComposerCardProps) {
  const composerSelectedSuggestion =
    composerSelection?.source === "predictive" ? composerSelection.suggestion : null;

  return (
    <SectionCard title="Composer" description="Un submit crea un batch y un job hijo por fuente seleccionada.">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Fuentes</label>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => {
                const active = composer.sources.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => setComposer((current) => ({ ...current, sources: toggleSource(current.sources, source) }))}
                    className={cn(
                      "rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                      active ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {source}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">&quot;google_places&quot; queda opt-in explícito y no se preselecciona en recomendaciones.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Niche</label>
            <input value={composer.niche} onChange={(event) => setComposer((current) => ({ ...current, niche: event.target.value }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm md:max-w-md" placeholder="restaurante, clínica, gimnasio..." />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ubicación</label>
            <DiscoveryLocationPicker
              token={token}
              mode="single"
              selected={composerSelection ? [composerSelection] : []}
              onChange={(next) => {
                const selection = next[0] ?? null;
                setComposerSelection(selection);
                setComposer((current) => ({ ...current, location: selection?.display_name ?? "", geo_selection: undefined }));
                setSelectedLocationKey(null);
                setPrefillNote(
                  selection
                    ? selection.source === "predictive"
                      ? `Predictivo ${selection.display_name}`
                      : `Catálogo ${selection.display_name}`
                    : null
                );
              }}
              niche={composer.niche}
              allowFreeText
              enablePredictive
              testId="composer-location"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Max results</label>
              <input type="number" min={1} max={1000} value={composer.max_results} onChange={(event) => setComposer((current) => ({ ...current, max_results: event.target.value }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CPU budget</label>
              <select value={composer.cpu_budget} onChange={(event) => setComposer((current) => ({ ...current, cpu_budget: event.target.value as DiscoveryComposerDraft["cpu_budget"] }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm">
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>
          </div>

          {includesGoogle ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile</label>
                  <select value={composer.google_profile} onChange={(event) => setComposer((current) => ({ ...current, google_profile: event.target.value as DiscoveryComposerDraft["google_profile"] }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm">
                    {PROFILES.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Concurrency</label>
                  <input type="number" min={1} max={10} value={composer.google_concurrency} onChange={(event) => setComposer((current) => ({ ...current, google_concurrency: event.target.value }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cost cap USD</label>
                  <input type="number" min={0.01} step="0.01" value={composer.google_cost_cap_usd} onChange={(event) => setComposer((current) => ({ ...current, google_cost_cap_usd: event.target.value }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm" />
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">Estimación</div>
                  <div className="mt-1">USD {estimatedGoogleCost.toFixed(2)}</div>
                  <div className="mt-2 text-xs text-slate-500">Mes usado: USD {budgetSpent?.toFixed(2) ?? "0.00"}</div>
                  <div className="text-xs text-slate-500">Remanente: {remainingBudget != null ? `USD ${remainingBudget.toFixed(2)}` : "—"}</div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={composer.enrich_after_discovery}
                onChange={(event) => setComposer((current) => ({ ...current, enrich_after_discovery: event.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">Encadenar enrichment después del discovery</p>
                <p className="mt-1 text-xs text-slate-600">Default en sí. Cada job hijo genera su enrich sobre el run descubierto y deja trazabilidad separada por run.</p>
              </div>
            </label>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Resumen del lote</p>
                <p className="mt-1 text-xs text-slate-500">Preview vivo de lo que se va a crear.</p>
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{composer.sources.length} jobs hijos</div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
              <div><span className="text-slate-500">Fuentes:</span> <span className="font-medium text-slate-900">{composer.sources.join(", ") || "—"}</span></div>
              <div><span className="text-slate-500">Ubicación efectiva:</span> <span className="font-medium text-slate-900">{effectiveComposerLocation || "—"}</span></div>
              <div><span className="text-slate-500">Costo estimado:</span> <span className="font-medium text-slate-900">USD {estimatedBatchCost.toFixed(2)}</span></div>
              <div><span className="text-slate-500">Cap máximo:</span> <span className="font-medium text-slate-900">{effectiveGoogleCap != null && Number.isFinite(effectiveGoogleCap) ? `USD ${effectiveGoogleCap.toFixed(2)}` : "—"}</span></div>
            <div><span className="text-slate-500">Origen:</span> <span className="font-medium text-slate-900">{composerSelectedSuggestion ? `predictivo · ${composerSelectedSuggestion.catalog_entry.location_key}` : prefillNote ?? "manual"}</span></div>
            <div><span className="text-slate-500">Mapa:</span> <span className="font-medium text-slate-900">{composer.geo_selection?.label ?? "sin zona seleccionada"}</span></div>
            <div><span className="text-slate-500">Modo:</span> <span className="font-medium text-slate-900">{composer.enrich_after_discovery ? "discovery + enrich" : "solo discovery"}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <PrefillBadge label="Ubicación prefill" active={Boolean(prefillNote && composer.location)} />
              <PrefillBadge label="Predictivo" active={Boolean(composerSelectedSuggestion)} />
              <PrefillBadge label="Niche prefill" active={Boolean(prefillNote && composer.niche)} />
              <PrefillBadge label="Fuentes sugeridas" active={Boolean(prefillNote && composer.sources.length > 0)} />
              <PrefillBadge label="Zona del mapa" active={Boolean(composer.geo_selection?.label)} />
            </div>
            {composer.geo_selection?.label ? (
              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                Zona activa desde el mapa: <span className="font-semibold">{composer.geo_selection.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setComposer((current) => ({ ...current, geo_selection: undefined }));
                    setSelectedLocationKey(null);
                    setPrefillNote(null);
                  }}
                  className="ml-3 font-medium underline underline-offset-2"
                >
                  Quitar zona
                </button>
              </div>
            ) : null}
            {batchWarnings.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {batchWarnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onReset} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Reset</button>
            <button onClick={onCreateBatch} disabled={creating || batchWarnings.length > 0} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">
              {creating ? "Creando…" : "Crear batch"}
            </button>
          </div>
        </div>
    </SectionCard>
  );
}
