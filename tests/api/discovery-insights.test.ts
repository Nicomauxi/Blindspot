import { describe, expect, it } from "vitest";
import { buildDiscoveryRecommendations, buildLeadDensityRows, estimateGooglePlacesBatchCost } from "../../api/src/routes/discovery-insights.js";

describe("discovery insights", () => {
  const leads = [
    {
      id: "lead-1",
      source: "yelu",
      niche: "restaurant",
      address: "Montevideo, Uruguay",
      prospect_score: 72,
      gps: { lat: -34.9, lng: -56.2 },
      corroborating_sources: [{ source: "osm" }],
    },
    {
      id: "lead-2",
      source: "mintur",
      niche: "hotel",
      address: "Punta del Este, Uruguay",
      prospect_score: 61,
      gps: { lat: -34.95, lng: -54.95 },
      corroborating_sources: [],
    },
  ];

  it("builds density rows using normalized locations", () => {
    const rows = buildLeadDensityRows(leads);
    expect(rows[0]?.location_key).toBe("montevideo");
    expect(rows[0]?.commercial_density_score).toBeGreaterThanOrEqual(0);
  });

  it("suggests only missing sources for coverage gaps", () => {
    const data = buildDiscoveryRecommendations({
      leads,
      discoveryJobs: [{ source: "yelu", niche: "restaurant", location: "Montevideo", created_at: "2026-05-20T10:00:00Z" }],
      budget: {
        google_places_budget_total: 200,
        google_places_budget_spent: 10,
        google_places_alert_threshold: 10,
      },
      completedRuns: [{ finished_at: "2026-05-20T10:00:00Z", stats: { estimated_cost_usd: 2.5 } }],
      selectedSources: ["yelu", "osm", "mintur"],
      limit: 10,
    });

    const montevideoRestaurant = data.coverage_gaps_global.find((gap) => gap.location_key === "montevideo" && gap.niche === "restaurant");
    expect(montevideoRestaurant?.present_sources).toEqual(expect.arrayContaining(["yelu", "osm"]));
    expect(montevideoRestaurant?.missing_sources).toContain("mintur");
    expect(montevideoRestaurant?.missing_sources).not.toContain("osm");
  });

  it("estimates Google Places batch cost conservatively", () => {
    expect(estimateGooglePlacesBatchCost(40)).toBeCloseTo(1.07, 2);
  });
});
