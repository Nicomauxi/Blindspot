import type { DiscoveryLeadDensityFilters, DiscoveryMapDensityLocation, LeadGeoSelection, NicheAliasGroup, ZoneLead } from "@/lib/api";
import type { DiscoveryComposerGeoSelection } from "@/lib/discovery-workspace";

export type LocationDensitySort = "density" | "leads" | "hot" | "prospect";
export type LocationDensityMapVariant = "lead-review" | "discovery-context";

export type MapPoint = {
  lat: number;
  lng: number;
};

const textCollator = new Intl.Collator("es", { sensitivity: "base", usage: "sort" });

export type NicheMarkerIconKey =
  | "default"
  | "food"
  | "lodging"
  | "health"
  | "retail"
  | "professional"
  | "education"
  | "beauty"
  | "automotive";

export type NicheMarkerIconOption = {
  key: NicheMarkerIconKey;
  label: string;
  emoji: string;
  tone: string;
  markerClassName: string;
};

export const NICHE_MARKER_ICON_OPTIONS: NicheMarkerIconOption[] = [
  { key: "default", label: "General", emoji: "•", tone: "text-slate-700", markerClassName: "border-slate-300 bg-white text-slate-700" },
  { key: "food", label: "Gastronomía", emoji: "🍽", tone: "text-amber-700", markerClassName: "border-amber-300 bg-amber-50 text-amber-700" },
  { key: "lodging", label: "Hotelería", emoji: "🛏", tone: "text-indigo-700", markerClassName: "border-indigo-300 bg-indigo-50 text-indigo-700" },
  { key: "health", label: "Salud", emoji: "✚", tone: "text-emerald-700", markerClassName: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { key: "retail", label: "Retail", emoji: "🛍", tone: "text-fuchsia-700", markerClassName: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700" },
  { key: "professional", label: "Profesional", emoji: "💼", tone: "text-cyan-700", markerClassName: "border-cyan-300 bg-cyan-50 text-cyan-700" },
  { key: "education", label: "Educación", emoji: "🎓", tone: "text-sky-700", markerClassName: "border-sky-300 bg-sky-50 text-sky-700" },
  { key: "beauty", label: "Belleza", emoji: "✂", tone: "text-rose-700", markerClassName: "border-rose-300 bg-rose-50 text-rose-700" },
  { key: "automotive", label: "Automotor", emoji: "🚗", tone: "text-orange-700", markerClassName: "border-orange-300 bg-orange-50 text-orange-700" },
];

const NICHE_MARKER_KEYWORDS: Array<{ key: NicheMarkerIconKey; terms: string[] }> = [
  { key: "food", terms: ["restaurant", "restaurante", "cafe", "cafeteria", "bar", "panaderia", "bakery", "food", "parrilla"] },
  { key: "lodging", terms: ["hotel", "hostel", "apart", "alojamiento", "posada"] },
  { key: "health", terms: ["clinic", "clinica", "salud", "hospital", "dent", "farmacia", "pharmacy"] },
  { key: "retail", terms: ["retail", "shop", "store", "tienda", "supermercado", "market", "ferreteria"] },
  { key: "professional", terms: ["estudio", "contable", "abogado", "legal", "consult", "agencia", "service"] },
  { key: "education", terms: ["school", "colegio", "liceo", "academ", "instituto", "education"] },
  { key: "beauty", terms: ["pelu", "barber", "salon", "beauty", "spa", "uñas", "unas"] },
  { key: "automotive", terms: ["taller", "auto", "mecan", "car", "motor"] },
];

function normalizeNicheToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLocaleLowerCase("es-UY")
    .trim();
}

export function formatLeadLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "Sin dato";
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toLocaleUpperCase("es-UY") + part.slice(1).toLocaleLowerCase("es-UY"))
    .join(" ");
}

export function resolveCanonicalNiche(niche: string | null | undefined, groups: NicheAliasGroup[] = []): string | null {
  if (!niche?.trim()) return null;
  const normalized = normalizeNicheToken(niche);
  const group = groups.find((entry) => normalizeNicheToken(entry.canonical) === normalized || entry.aliases.some((alias) => normalizeNicheToken(alias) === normalized));
  return group?.canonical ?? niche.trim();
}

export function getNicheMarkerOption(key: NicheMarkerIconKey): NicheMarkerIconOption {
  return NICHE_MARKER_ICON_OPTIONS.find((option) => option.key === key) ?? NICHE_MARKER_ICON_OPTIONS[0]!;
}

export function resolveDefaultNicheMarkerIcon(niche: string | null | undefined, groups: NicheAliasGroup[] = []): NicheMarkerIconKey {
  const canonical = resolveCanonicalNiche(niche, groups);
  const normalized = canonical ? normalizeNicheToken(canonical) : "";
  for (const candidate of NICHE_MARKER_KEYWORDS) {
    if (candidate.terms.some((term) => normalized.includes(term))) {
      return candidate.key;
    }
  }
  return "default";
}

export function resolveLeadMarkerIcon(
  lead: Pick<ZoneLead, "niche">,
  groups: NicheAliasGroup[] = [],
  preferences: Record<string, NicheMarkerIconKey> = {}
): NicheMarkerIconOption {
  const canonical = resolveCanonicalNiche(lead.niche, groups);
  const preferenceKey = canonical ? normalizeNicheToken(canonical) : "";
  const selected = preferenceKey ? preferences[preferenceKey] : undefined;
  return getNicheMarkerOption(selected ?? resolveDefaultNicheMarkerIcon(lead.niche, groups));
}

export function buildNichePreferenceKey(niche: string | null | undefined, groups: NicheAliasGroup[] = []): string | null {
  const canonical = resolveCanonicalNiche(niche, groups);
  return canonical ? normalizeNicheToken(canonical) : null;
}

export function countLocationPoints(location: DiscoveryMapDensityLocation): number {
  return location.gps_points.length;
}

export function computeLocationCentroid(location: DiscoveryMapDensityLocation): MapPoint | null {
  if (location.grid_center) return location.grid_center;
  if (location.gps_points.length === 0) return null;
  const totals = location.gps_points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: totals.lat / location.gps_points.length,
    lng: totals.lng / location.gps_points.length,
  };
}

export function filterAndSortLocations(
  locations: DiscoveryMapDensityLocation[],
  search: string,
  sort: LocationDensitySort
): DiscoveryMapDensityLocation[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("es-UY");
  const filtered = normalizedSearch
    ? locations.filter((location) => {
        const haystack = `${location.location_label} ${location.parent_location_label}`.toLocaleLowerCase("es-UY");
        return haystack.includes(normalizedSearch);
      })
    : locations;

  return [...filtered].sort((left, right) => {
    const delta =
      sort === "leads"
        ? right.lead_count - left.lead_count
        : sort === "hot"
          ? right.hot_leads_count - left.hot_leads_count
          : sort === "prospect"
            ? right.avg_prospect_score - left.avg_prospect_score
            : right.commercial_density_score - left.commercial_density_score;
    if (delta !== 0) return delta;
    return textCollator.compare(left.location_label, right.location_label);
  });
}

export function parseGranularLocationKey(locationKey: string): { parentLocationKey: string; gridLocationKey: string } | null {
  const [parentLocationKey, gridLocationKey] = locationKey.split("::", 2);
  if (!parentLocationKey || !gridLocationKey) return null;
  return { parentLocationKey, gridLocationKey };
}

function normalizeFilterArray(values?: string[]): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return [...values].sort(textCollator.compare);
}

export function normalizeLeadDensityFilters(filters: DiscoveryLeadDensityFilters): DiscoveryLeadDensityFilters {
  const normalized: DiscoveryLeadDensityFilters = {};
  if (filters.location) normalized.location = filters.location;
  if (filters.limit != null) normalized.limit = filters.limit;
  if (filters.source?.length) normalized.source = normalizeFilterArray(filters.source);
  if (filters.niche?.trim()) normalized.niche = filters.niche.trim();
  if ((filters.prospect_score_gte ?? 0) > 0) normalized.prospect_score_gte = filters.prospect_score_gte;
  if (filters.contact_tier?.length) normalized.contact_tier = normalizeFilterArray(filters.contact_tier);
  if (filters.gps_source?.length) normalized.gps_source = [...filters.gps_source].sort(textCollator.compare);
  if (filters.zone_ids?.length) normalized.zone_ids = normalizeFilterArray(filters.zone_ids);
  return normalized;
}

export function areLeadDensityFiltersEqual(left: DiscoveryLeadDensityFilters, right: DiscoveryLeadDensityFilters): boolean {
  return JSON.stringify(normalizeLeadDensityFilters(left)) === JSON.stringify(normalizeLeadDensityFilters(right));
}

export function buildLeadExplorerGeoHref(location: Pick<DiscoveryMapDensityLocation, "parent_location_key" | "location_key">): string {
  const parsed = parseGranularLocationKey(location.location_key);
  const params = new URLSearchParams();
  params.set("parent_location_keys", location.parent_location_key);
  if (parsed?.gridLocationKey) params.set("grid_location_keys", parsed.gridLocationKey);
  return `/admin/leads?${params.toString()}`;
}

export function buildLeadExplorerGeoSelection(
  location: Pick<DiscoveryMapDensityLocation, "location_key" | "location_label" | "parent_location_key">
): (LeadGeoSelection & { label: string }) {
  const parsed = parseGranularLocationKey(location.location_key);
  return {
    label: location.location_label,
    parent_location_keys: [location.parent_location_key],
    ...(parsed?.gridLocationKey ? { grid_location_keys: [parsed.gridLocationKey] } : {}),
  };
}

export function buildComposerGeoSelection(
  location: Pick<DiscoveryMapDensityLocation, "location_key" | "location_label" | "parent_location_key">
): DiscoveryComposerGeoSelection {
  const parsed = parseGranularLocationKey(location.location_key);
  return {
    label: location.location_label,
    parent_location_keys: [location.parent_location_key],
    grid_location_keys: parsed?.gridLocationKey ? [parsed.gridLocationKey] : undefined,
  };
}

export function buildZoneLeadRequest(
  location: Pick<DiscoveryMapDensityLocation, "location_key" | "parent_location_key">,
  limit = 200
): { location_key: string; parent_location_key: string; grid_location_key?: string; limit: number } {
  const parsed = parseGranularLocationKey(location.location_key);
  return {
    location_key: location.location_key,
    parent_location_key: location.parent_location_key,
    ...(parsed?.gridLocationKey ? { grid_location_key: parsed.gridLocationKey } : {}),
    limit,
  };
}
