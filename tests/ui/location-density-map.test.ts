import { describe, expect, it } from "vitest";
import { computeLocationCentroid, countLocationPoints, filterAndSortLocations } from "../../ui/src/lib/location-density-map";
import type { DiscoveryLocationDensity } from "../../ui/src/lib/api";

const locations: DiscoveryLocationDensity[] = [
  {
    location_key: "montevideo-centro",
    location_label: "Montevideo Centro",
    lead_count: 18,
    hot_leads_count: 5,
    avg_prospect_score: 62.4,
    commercial_density_score: 91,
    gps_points: [
      { lat: -34.905, lng: -56.191 },
      { lat: -34.901, lng: -56.188 },
    ],
  },
  {
    location_key: "canelones-sur",
    location_label: "Canelones Sur",
    lead_count: 24,
    hot_leads_count: 3,
    avg_prospect_score: 58.1,
    commercial_density_score: 79,
    gps_points: [{ lat: -34.72, lng: -56.22 }],
  },
  {
    location_key: "punta-del-este",
    location_label: "Punta del Este",
    lead_count: 10,
    hot_leads_count: 7,
    avg_prospect_score: 74.3,
    commercial_density_score: 88,
    gps_points: [],
  },
];

describe("location density map helpers", () => {
  it("filters by location label and sorts by the requested metric", () => {
    const filtered = filterAndSortLocations(locations, "sur", "leads");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.location_key).toBe("canelones-sur");
  });

  it("sorts by density by default and uses label as deterministic tiebreaker", () => {
    const sorted = filterAndSortLocations(locations, "", "density");

    expect(sorted.map((location) => location.location_key)).toEqual([
      "montevideo-centro",
      "punta-del-este",
      "canelones-sur",
    ]);
  });

  it("computes centroid and exact point count from gps points", () => {
    expect(countLocationPoints(locations[0]!)).toBe(2);
    const centroid = computeLocationCentroid(locations[0]!);
    expect(centroid).not.toBeNull();
    expect(centroid?.lat).toBeCloseTo(-34.903, 6);
    expect(centroid?.lng).toBeCloseTo(-56.1895, 6);
    expect(computeLocationCentroid(locations[2]!)).toBeNull();
  });
});
