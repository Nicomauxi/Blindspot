import type { DiscoveryLocationDensity } from "@/lib/api";

export type LocationDensitySort = "density" | "leads" | "hot" | "prospect";

export type MapPoint = {
  lat: number;
  lng: number;
};

const textCollator = new Intl.Collator("es", { sensitivity: "base", usage: "sort" });

export function countLocationPoints(location: DiscoveryLocationDensity): number {
  return location.gps_points.length;
}

export function computeLocationCentroid(location: DiscoveryLocationDensity): MapPoint | null {
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
  locations: DiscoveryLocationDensity[],
  search: string,
  sort: LocationDensitySort
): DiscoveryLocationDensity[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("es-UY");
  const filtered = normalizedSearch
    ? locations.filter((location) => location.location_label.toLocaleLowerCase("es-UY").includes(normalizedSearch))
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
