import type { DiscoveryMapDensityLocation } from "@/lib/api";

export type LocationDensitySort = "density" | "leads" | "hot" | "prospect";

export type MapPoint = {
  lat: number;
  lng: number;
};

const textCollator = new Intl.Collator("es", { sensitivity: "base", usage: "sort" });

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

export function buildLeadExplorerGeoHref(location: Pick<DiscoveryMapDensityLocation, "parent_location_key" | "location_key">): string {
  const parsed = parseGranularLocationKey(location.location_key);
  const params = new URLSearchParams();
  params.set("parent_location_keys", location.parent_location_key);
  if (parsed?.gridLocationKey) params.set("grid_location_keys", parsed.gridLocationKey);
  return `/admin/leads?${params.toString()}`;
}
