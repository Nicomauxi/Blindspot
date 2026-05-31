"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getDiscoveryLocationSuggestions,
  listDiscoveryPlacesCatalog,
  type DiscoveryLocationSuggestion,
  type DiscoveryPlaceCatalogEntry,
  type DiscoveryPlaceKind,
} from "@/lib/api";
import {
  catalogEntryToSelection,
  freeTextToSelection,
  suggestionToSelection,
  toggleSelection,
  type DiscoveryLocationSelection,
} from "@/lib/discovery-location";
import { cn, formatRelative } from "@/lib/utils";

type PickerTab = "catalog" | "predictive";

interface DiscoveryLocationPickerProps {
  token: string | null;
  mode: "single" | "multi";
  selected: DiscoveryLocationSelection[];
  onChange: (next: DiscoveryLocationSelection[]) => void;
  /** Contexto de nicho para el scoring predictivo. */
  niche?: string;
  /** Permite agregar ubicaciones ad-hoc por texto (composer). */
  allowFreeText?: boolean;
  /** Habilita el tab de sugerencias predictivas. */
  enablePredictive?: boolean;
  /** Prefijo para data-testid (ej. "composer-location"). */
  testId?: string;
}

const KIND_OPTIONS: { value: DiscoveryPlaceKind; label: string }[] = [
  { value: "departamento", label: "Departamento" },
  { value: "ciudad", label: "Ciudad" },
  { value: "barrio", label: "Barrio" },
  { value: "zona_turistica", label: "Zona turística" },
  { value: "polo_industrial", label: "Polo industrial" },
  { value: "avenida", label: "Avenida" },
];

function kindLabel(kind: DiscoveryPlaceKind | null): string {
  if (!kind) return "Ad-hoc";
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind.replaceAll("_", " ");
}

const IMPORTS_HREF = "/admin/imports";

export function DiscoveryLocationPicker({
  token,
  mode,
  selected,
  onChange,
  niche,
  allowFreeText = false,
  enablePredictive = false,
  testId = "location-picker",
}: DiscoveryLocationPickerProps) {
  const [tab, setTab] = useState<PickerTab>("catalog");

  const [catalogQuery, setCatalogQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<DiscoveryPlaceKind | null>(null);
  const [catalogEntries, setCatalogEntries] = useState<DiscoveryPlaceCatalogEntry[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [predictiveSeed, setPredictiveSeed] = useState("");
  const [suggestions, setSuggestions] = useState<DiscoveryLocationSuggestion[]>([]);
  const [predictiveLoading, setPredictiveLoading] = useState(false);
  const [predictiveError, setPredictiveError] = useState<string | null>(null);

  const [freeText, setFreeText] = useState("");

  const selectedKeys = useMemo(() => new Set(selected.map((entry) => entry.key)), [selected]);

  // Catálogo: búsqueda debounced.
  useEffect(() => {
    if (!token) return;
    setCatalogLoading(true);
    const timeout = window.setTimeout(() => {
      void listDiscoveryPlacesCatalog(token, {
        q: catalogQuery.trim() || undefined,
        kind: kindFilter ?? undefined,
        limit: 120,
      })
        .then((response) => {
          setCatalogEntries(response.data);
          setCatalogTotal(response.total);
          setCatalogError(null);
        })
        .catch((err) => {
          setCatalogEntries([]);
          setCatalogTotal(0);
          const msg = err instanceof Error ? err.message : "";
          const isSetupIssue = msg.includes("schema") || msg.includes("not exist") || msg.includes("table");
          setCatalogError(
            isSetupIssue
              ? "El catálogo de lugares no está disponible aún. Un administrador debe aplicar las migraciones pendientes."
              : "No se pudo cargar el catálogo. Intentá recargar la página."
          );
        })
        .finally(() => setCatalogLoading(false));
    }, 200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [token, catalogQuery, kindFilter]);

  // Predictivo: sugerencias scoreadas según nicho + seed de ciudad.
  useEffect(() => {
    if (!token || !enablePredictive || tab !== "predictive") {
      return;
    }
    setPredictiveLoading(true);
    const timeout = window.setTimeout(() => {
      void getDiscoveryLocationSuggestions(token, {
        ciudad: predictiveSeed.trim() || undefined,
        niche: niche?.trim() || undefined,
        limit: 12,
      })
        .then((response) => {
          setSuggestions(response.data);
          setPredictiveError(null);
        })
        .catch((err) => {
          setSuggestions([]);
          setPredictiveError(
            err instanceof Error ? err.message : "No se pudieron calcular las sugerencias predictivas."
          );
        })
        .finally(() => setPredictiveLoading(false));
    }, 220);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [token, enablePredictive, tab, predictiveSeed, niche]);

  function handleToggle(next: DiscoveryLocationSelection) {
    onChange(toggleSelection(selected, next, mode));
  }

  function handleRemove(key: string) {
    onChange(selected.filter((entry) => entry.key !== key));
  }

  function handleAddFreeText() {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    handleToggle(freeTextToSelection(trimmed));
    setFreeText("");
  }

  const showPredictiveTab = enablePredictive;

  return (
    <div className="space-y-3" data-testid={testId}>
      {/* Seleccionados */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {mode === "single" ? "Ubicación elegida" : "Ubicaciones elegidas"}
        </p>
        {selected.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2" data-testid={`${testId}-chips`}>
            {selected.map((entry) => (
              <span
                key={entry.key}
                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800"
              >
                <span>{entry.display_name}</span>
                <span className="text-[10px] uppercase tracking-wide text-sky-500">
                  {kindLabel(entry.kind)}
                  {entry.parent_location ? ` · ${entry.parent_location}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(entry.key)}
                  aria-label={`Quitar ${entry.display_name}`}
                  className="text-sky-500 hover:text-sky-700"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Todavía no elegiste ninguna ubicación.</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("catalog")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
            tab === "catalog"
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          )}
        >
          Catálogo
        </button>
        {showPredictiveTab ? (
          <button
            type="button"
            onClick={() => setTab("predictive")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === "predictive"
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            Predictivo
          </button>
        ) : null}
      </div>

      {tab === "catalog" ? (
        <div className="space-y-3" data-testid={`${testId}-catalog`}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder="Buscar por nombre o key…"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setKindFilter(null)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                kindFilter === null
                  ? "border-sky-300 bg-sky-50 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              Todos
            </button>
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKindFilter((current) => (current === option.value ? null : option.value))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  kindFilter === option.value
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {catalogError ? <p className="text-sm text-rose-600">{catalogError}</p> : null}
          {catalogLoading ? <p className="text-sm text-slate-500">Cargando catálogo…</p> : null}

          {!catalogLoading && !catalogError && catalogEntries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              {catalogQuery || kindFilter
                ? "Sin resultados en el catálogo para este filtro."
                : "No hay lugares en el catálogo."}{" "}
              Cargá un archivo desde{" "}
              <Link href={IMPORTS_HREF} className="font-medium text-sky-700 underline underline-offset-2">
                Plataforma &gt; Importación
              </Link>
              {allowFreeText ? " o usá el campo de ubicación manual abajo." : "."}
            </div>
          ) : null}

          {catalogEntries.length > 0 ? (
            <>
              <p className="text-xs text-slate-500">
                {catalogTotal} lugares en catálogo{catalogQuery ? ` · filtrando “${catalogQuery}”` : ""}.
              </p>
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                {catalogEntries.map((entry) => {
                  const active = selectedKeys.has(entry.location_key);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => handleToggle(catalogEntryToSelection(entry))}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-sky-300 bg-sky-50"
                          : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-slate-800">{entry.display_name}</p>
                        {entry.commercial_score != null ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {entry.commercial_score}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {kindLabel(entry.kind)}
                        {entry.parent_location ? ` · ${entry.parent_location}` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "predictive" && showPredictiveTab ? (
        <div className="space-y-3" data-testid={`${testId}-predictive`}>
          <input
            type="text"
            value={predictiveSeed}
            onChange={(event) => setPredictiveSeed(event.target.value)}
            placeholder="Ciudad base (opcional) — ej. Montevideo"
            className="w-full rounded-xl border border-violet-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <p className="text-xs text-slate-500">
            El algoritmo sugiere lugares del catálogo con score explicable. No crea nada hasta confirmar.
          </p>

          {predictiveLoading ? <p className="text-sm text-slate-500">Calculando sugerencias…</p> : null}
          {predictiveError ? <p className="text-sm text-rose-600">{predictiveError}</p> : null}

          {!predictiveLoading && !predictiveError && suggestions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-violet-200 bg-white px-4 py-4 text-sm text-slate-600">
              No hay sugerencias para este contexto. El catálogo sigue disponible en{" "}
              <Link href={IMPORTS_HREF} className="font-medium text-violet-700 underline underline-offset-2">
                Plataforma &gt; Importación
              </Link>
              .
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <div className="grid max-h-80 gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
              {suggestions.map((suggestion) => {
                const active = selectedKeys.has(suggestion.catalog_entry.location_key);
                return (
                  <button
                    key={suggestion.catalog_entry.id}
                    type="button"
                    onClick={() => handleToggle(suggestionToSelection(suggestion))}
                    className={cn(
                      "rounded-2xl border bg-white px-4 py-3 text-left transition-colors",
                      active ? "border-violet-300 bg-violet-50/40" : "border-slate-200 hover:border-violet-200"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {suggestion.catalog_entry.display_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 capitalize">
                          {kindLabel(suggestion.catalog_entry.kind)} · confianza {suggestion.confidence}
                        </p>
                      </div>
                      <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                        {suggestion.score}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                      <div>
                        Esperado: <span className="font-semibold text-slate-900">{suggestion.expected_new_leads}</span>
                      </div>
                      <div>
                        Duplicados:{" "}
                        <span className="font-semibold text-slate-900">
                          {Math.round(suggestion.duplicate_risk * 100)}%
                        </span>
                      </div>
                      <div>
                        Costo:{" "}
                        <span className="font-semibold text-slate-900">
                          {suggestion.cost_estimate != null ? `USD ${suggestion.cost_estimate.toFixed(2)}` : "—"}
                        </span>
                      </div>
                      <div>
                        Último:{" "}
                        <span className="font-semibold text-slate-900">
                          {suggestion.historical_metrics.last_discovery_at
                            ? formatRelative(suggestion.historical_metrics.last_discovery_at)
                            : "sin histórico"}
                        </span>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-slate-600">
                      {suggestion.reasons.slice(0, 2).map((reason) => (
                        <li key={reason}>• {reason}</li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Fallback texto libre */}
      {allowFreeText ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <span className="text-xs font-medium text-slate-500">Otra ubicación:</span>
          <input
            type="text"
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddFreeText();
              }
            }}
            placeholder="Ubicación ad-hoc…"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            data-testid={`${testId}-freetext-input`}
          />
          <button
            type="button"
            onClick={handleAddFreeText}
            disabled={!freeText.trim()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {mode === "single" ? "Usar" : "Agregar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
