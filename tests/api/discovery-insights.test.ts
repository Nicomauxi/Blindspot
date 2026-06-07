import { describe, expect, it, vi } from "vitest";
import {
  buildGridCell,
  buildDiscoveryRecommendations,
  buildLeadDensityRows,
  buildLeadDensitySnapshot,
  estimateGooglePlacesBatchCost,
  parseGranularLocationKey,
} from "../../api/src/routes/discovery-insights.js";

describe("discovery insights", () => {
  const leads = [
    {
      id: "lead-1",
      source: "yelu",
      niche: "restaurant",
      address: "Montevideo, Uruguay",
      prospect_score: 72,
      contact_tier: "A",
      gps: { lat: -34.9, lng: -56.2 },
      corroborating_sources: [{ source: "osm" }],
    },
    {
      id: "lead-2",
      source: "mintur",
      niche: "hotel",
      address: "Punta del Este, Uruguay",
      prospect_score: 61,
      contact_tier: "B",
      gps: { lat: -34.95, lng: -54.95 },
      corroborating_sources: [],
    },
  ];

  it("builds density rows using normalized locations", () => {
    const rows = buildLeadDensityRows(leads);
    expect(rows[0]?.location_key).toBe("montevideo");
    expect(rows[0]?.commercial_density_score).toBeGreaterThanOrEqual(0);
  });

  it("builds granular density cells and geocodes missing GPS addresses", async () => {
    const geocodeAddress = vi.fn(async (address: string) => {
      if (address.includes("Pocitos")) return { lat: -34.916, lng: -56.149 };
      return null;
    });

    const snapshot = await buildLeadDensitySnapshot([
      {
        id: "gps-lead",
        source: "yelu",
        niche: "restaurant",
        address: "Pocitos, Montevideo, Uruguay",
        prospect_score: 80,
        contact_tier: "A",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
      {
        id: "geocoded-lead",
        source: "osm",
        niche: "restaurant",
        address: "Benito Blanco 1234, Pocitos, Montevideo",
        prospect_score: 58,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "unresolved-lead",
        source: "mintur",
        niche: "hotel",
        address: "Dirección sin match, Montevideo",
        prospect_score: 40,
        contact_tier: "C",
        gps: null,
        corroborating_sources: [],
      },
    ], {
      geocodeAddress,
      maxGeocodes: 10,
    });

    expect(geocodeAddress).toHaveBeenCalledTimes(2);
    expect(snapshot.meta.raw_gps_leads).toBe(1);
    expect(snapshot.meta.geocoded_address_leads).toBe(1);
    expect(snapshot.meta.unresolved_address_leads).toBe(1);
    expect(snapshot.meta.filtered_leads).toBe(3);
    expect(snapshot.meta.positioned_leads).toBe(2);
    expect(snapshot.locations[0]?.parent_location_label).toBe("Montevideo");
    expect(snapshot.locations.some((location) => location.geocoded_lead_count > 0)).toBe(true);
    expect(snapshot.geocoded_points).toContainEqual({ lat: -34.916, lng: -56.149 });
  });

  it("keeps the density snapshot alive when a geocode request fails", async () => {
    const geocodeAddress = vi.fn(async (address: string) => {
      if (address.includes("throws")) throw new Error("provider unavailable");
      if (address.includes("invalid")) return { lat: 999, lng: -56.149 };
      return { lat: -34.916, lng: -56.149 };
    });

    const snapshot = await buildLeadDensitySnapshot([
      {
        id: "throws-lead",
        source: "osm",
        niche: "restaurant",
        address: "throws street, Montevideo",
        prospect_score: 62,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "invalid-lead",
        source: "osm",
        niche: "restaurant",
        address: "invalid point, Montevideo",
        prospect_score: 62,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "valid-lead",
        source: "osm",
        niche: "restaurant",
        address: "valid point, Montevideo",
        prospect_score: 62,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
    ], {
      geocodeAddress,
      maxGeocodes: 10,
    });

    expect(geocodeAddress).toHaveBeenCalledTimes(3);
    expect(snapshot.meta.filtered_leads).toBe(3);
    expect(snapshot.meta.positioned_leads).toBe(1);
    expect(snapshot.meta.unresolved_address_leads).toBe(2);
    expect(snapshot.meta.geocoded_address_leads).toBe(1);
    expect(snapshot.viewport_leads.map((lead) => lead.id)).toEqual(["valid-lead"]);
  });

  it("tracks deferred geocodes separately from unresolved addresses", async () => {
    const geocodeAddress = vi.fn(async () => null);

    const snapshot = await buildLeadDensitySnapshot([
      {
        id: "lead-1",
        source: "yelu",
        niche: "restaurant",
        address: "Calle 1, Montevideo",
        prospect_score: 50,
        contact_tier: "A",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "lead-2",
        source: "osm",
        niche: "restaurant",
        address: "Calle 2, Montevideo",
        prospect_score: 55,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
    ], {
      geocodeAddress,
      maxGeocodes: 1,
    });

    expect(snapshot.meta.unresolved_address_leads).toBe(1);
    expect(snapshot.meta.deferred_geocode_leads).toBe(1);
  });

  it("applies source, niche, score, tier and gps-source filters before aggregating", async () => {
    const geocodeAddress = vi.fn(async (address: string) => {
      if (address.includes("Pocitos")) return { lat: -34.916, lng: -56.149 };
      return null;
    });

    const snapshot = await buildLeadDensitySnapshot([
      {
        id: "google-lead",
        source: "google_places",
        niche: "restaurant",
        address: "Pocitos, Montevideo",
        prospect_score: 82,
        contact_tier: "B",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
      {
        id: "real-gps-lead",
        source: "yelu",
        niche: "restaurant",
        address: "Pocitos, Montevideo",
        prospect_score: 88,
        contact_tier: "B",
        gps: { lat: -34.901, lng: -56.188 },
        corroborating_sources: [],
      },
      {
        id: "inferred-lead",
        source: "osm",
        niche: "restaurant",
        address: "Benito Blanco 1234, Pocitos, Montevideo",
        prospect_score: 76,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "filtered-out-lead",
        source: "google_places",
        niche: "hotel",
        address: "Carrasco, Montevideo",
        prospect_score: 40,
        contact_tier: "C",
        gps: { lat: -34.89, lng: -56.05 },
        corroborating_sources: [],
      },
    ], {
      filters: {
        sources: ["google_places", "osm"],
        niche: "restau",
        prospect_score_gte: 70,
        contact_tiers: ["B"],
        gps_sources: ["google", "inferred"],
      },
      geocodeAddress,
      maxGeocodes: 10,
    });

    expect(snapshot.meta.filtered_leads).toBe(2);
    expect(snapshot.meta.positioned_leads).toBe(2);
    expect(snapshot.meta.raw_gps_leads).toBe(1);
    expect(snapshot.meta.geocoded_address_leads).toBe(1);
    expect(geocodeAddress).toHaveBeenCalledTimes(1);
    expect(snapshot.locations.length).toBeGreaterThan(0);
  });

  it("parses granular location keys and reuses the same grid math as the snapshot", () => {
    const cell = buildGridCell({ lat: -34.905, lng: -56.191 });
    const parsed = parseGranularLocationKey(`montevideo::${cell.gridKey}`);

    expect(parsed).toEqual({
      parent_location_key: "montevideo",
      grid_location_key: cell.gridKey,
    });
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
