import type {
  DiscoveryLocationSuggestion,
  DiscoveryPlaceCatalogEntry,
  DiscoveryPlaceKind,
  PredictiveLocationContext,
} from "@/lib/api";

/**
 * Origen de una ubicación elegida en el Workspace de discovery.
 * - catalog: entrada real del Catálogo de lugares.
 * - predictive: sugerencia scoreada (lleva snapshot para trazabilidad).
 * - freetext: ubicación ad-hoc tipeada o heredada de un prefill (mapa/gap).
 */
export type LocationSelectionSource = "catalog" | "predictive" | "freetext";

/**
 * Contrato único de selección de locación compartido por todas las superficies
 * del Workspace de discovery. Centraliza la serialización para que el composer
 * y la creación masiva no dupliquen parsing ni armado de payload.
 */
export type DiscoveryLocationSelection = {
  /** Identidad estable para togglear/deduplicar: location_key del catálogo o `freetext:<slug>`. */
  key: string;
  /** Valor que viaja como `location` del job. */
  display_name: string;
  kind: DiscoveryPlaceKind | null;
  parent_location: string | null;
  commercial_score: number | null;
  source: LocationSelectionSource;
  /** Para predictive_context (solo en sugerencias predictivas). */
  catalog_entry_id: string | null;
  /** Snapshot del scoring para trazabilidad (solo predictivo). */
  suggestion: DiscoveryLocationSuggestion | null;
};

const DIACRITICS = /\p{Diacritic}+/gu;

/** Slug determinístico para ubicaciones ad-hoc (sin dependencias nuevas). */
export function slugifyLocation(input: string): string {
  return input
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLocaleLowerCase("es-UY")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function catalogEntryToSelection(entry: DiscoveryPlaceCatalogEntry): DiscoveryLocationSelection {
  return {
    key: entry.location_key,
    display_name: entry.display_name,
    kind: entry.kind,
    parent_location: entry.parent_location,
    commercial_score: entry.commercial_score,
    source: "catalog",
    catalog_entry_id: entry.id,
    suggestion: null,
  };
}

export function suggestionToSelection(suggestion: DiscoveryLocationSuggestion): DiscoveryLocationSelection {
  const entry = suggestion.catalog_entry;
  return {
    key: entry.location_key,
    display_name: entry.display_name,
    kind: entry.kind,
    parent_location: entry.parent_location,
    commercial_score: entry.commercial_score,
    source: "predictive",
    catalog_entry_id: entry.id,
    suggestion,
  };
}

export function freeTextToSelection(text: string): DiscoveryLocationSelection {
  const trimmed = text.trim();
  const slug = slugifyLocation(trimmed);
  return {
    key: slug ? `freetext:${slug}` : `freetext:${trimmed}`,
    display_name: trimmed,
    kind: null,
    parent_location: null,
    commercial_score: null,
    source: "freetext",
    catalog_entry_id: null,
    suggestion: null,
  };
}

/** Arma el predictive_context para el payload del job. Solo aplica a selecciones predictivas. */
export function buildPredictiveContext(
  selection: DiscoveryLocationSelection
): PredictiveLocationContext | undefined {
  if (selection.source !== "predictive" || !selection.catalog_entry_id) return undefined;
  return {
    suggestion_source: "predictive_location",
    location_catalog_entry_id: selection.catalog_entry_id,
    ...(selection.suggestion ? { opportunity_score_snapshot: selection.suggestion } : {}),
  };
}

/** Origen de recomendación para el batch del composer, derivado de la selección. */
export function buildRecommendationOrigin(
  selection: DiscoveryLocationSelection | null,
  manualKey?: string | null
): { type: "manual" | "predictive_location"; key?: string } {
  if (selection?.source === "predictive" && selection.suggestion) {
    return { type: "predictive_location", key: selection.suggestion.catalog_entry.location_key };
  }
  return manualKey ? { type: "manual", key: manualKey } : { type: "manual" };
}

/** Togglea una selección dentro de una lista respetando el modo single/multi. */
export function toggleSelection(
  current: DiscoveryLocationSelection[],
  next: DiscoveryLocationSelection,
  mode: "single" | "multi"
): DiscoveryLocationSelection[] {
  const exists = current.some((entry) => entry.key === next.key);
  if (mode === "single") {
    return exists ? [] : [next];
  }
  return exists ? current.filter((entry) => entry.key !== next.key) : [...current, next];
}
