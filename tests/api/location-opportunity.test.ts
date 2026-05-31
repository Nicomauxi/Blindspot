import { describe, expect, it } from "vitest";
import { buildLocationOpportunitySuggestions } from "../../src/modules/discovery/location-opportunity.js";

describe("location opportunity scoring", () => {
  const catalog = [
    {
      id: "dept-mvd",
      location_key: "montevideo-departamento",
      display_name: "Montevideo",
      parent_location: null,
      kind: "departamento",
      commercial_score: 70,
    },
    {
      id: "city-mvd",
      location_key: "montevideo",
      display_name: "Montevideo",
      parent_location: "Montevideo",
      kind: "ciudad",
      commercial_score: 82,
    },
    {
      id: "barrio-pocitos",
      location_key: "pocitos",
      display_name: "Pocitos",
      parent_location: "Montevideo",
      kind: "barrio",
      commercial_score: 91,
    },
    {
      id: "city-salto",
      location_key: "salto",
      display_name: "Salto",
      parent_location: null,
      kind: "ciudad",
      commercial_score: 64,
    },
  ];

  it("ranks high-success low-duplication zones above weaker zones", () => {
    const suggestions = buildLocationOpportunitySuggestions({
      catalog,
      discoveryJobs: [
        {
          source: "google_places",
          niche: "restaurant",
          location: "Montevideo",
          created_at: "2026-02-01T10:00:00Z",
          completed_at: "2026-02-01T10:00:00Z",
          leads_found: 20,
          leads_new: 10,
          estimated_cost_usd: 2,
        },
        {
          source: "google_places",
          niche: "restaurant",
          location: "Montevideo",
          created_at: "2026-02-10T10:00:00Z",
          completed_at: "2026-02-10T10:00:00Z",
          leads_found: 18,
          leads_new: 9,
          estimated_cost_usd: 1.8,
        },
        {
          source: "google_places",
          niche: "restaurant",
          location: "Salto",
          created_at: "2026-02-11T10:00:00Z",
          completed_at: "2026-02-11T10:00:00Z",
          leads_found: 16,
          leads_new: 2,
          estimated_cost_usd: 2.4,
        },
      ],
      leads: [
        { id: "lead-1", niche: "restaurant", address: "Centro, Montevideo, Uruguay" },
        { id: "lead-2", niche: "restaurant", address: "Centro, Salto, Uruguay" },
      ],
      filters: { niche: "restaurant", limit: 10 },
    });

    expect(suggestions[0]?.catalog_entry.location_key).toBe("montevideo");
    const salto = suggestions.find((entry) => entry.catalog_entry.location_key === "salto");
    expect(salto).toBeDefined();
    expect(suggestions[0]!.score).toBeGreaterThan(salto!.score);
  });

  it("penalizes high duplication and very recent discovery", () => {
    const recentIso = new Date(Date.now() - 3 * 86400000).toISOString();
    const suggestions = buildLocationOpportunitySuggestions({
      catalog,
      discoveryJobs: [
        {
          source: "google_places",
          niche: "restaurant",
          location: "Montevideo",
          created_at: recentIso,
          completed_at: recentIso,
          leads_found: 15,
          leads_new: 2,
          estimated_cost_usd: 4.5,
        },
      ],
      leads: [{ id: "lead-1", niche: "restaurant", address: "Centro, Montevideo, Uruguay" }],
      filters: { niche: "restaurant" },
    });

    const montevideo = suggestions.find((entry) => entry.catalog_entry.location_key === "montevideo");
    expect(montevideo).toBeDefined();
    expect(montevideo!.score).toBeLessThan(45);
    expect(montevideo!.reasons.join(" ")).toContain("Discovery muy reciente");
  });

  it("returns low confidence exploratory suggestions when there is no history", () => {
    const suggestions = buildLocationOpportunitySuggestions({
      catalog,
      discoveryJobs: [],
      leads: [],
      filters: { niche: "restaurant", limit: 10 },
    });

    const pocitos = suggestions.find((entry) => entry.catalog_entry.location_key === "pocitos");
    expect(pocitos).toBeDefined();
    expect(pocitos!.confidence).toBe("low");
    expect(pocitos!.reasons.join(" ")).toContain("exploración");
  });

  it("inherits city history for barrio suggestions with lower confidence", () => {
    const suggestions = buildLocationOpportunitySuggestions({
      catalog,
      discoveryJobs: [
        {
          source: "google_places",
          niche: "restaurant",
          location: "Montevideo",
          created_at: "2026-01-01T10:00:00Z",
          completed_at: "2026-01-01T10:00:00Z",
          leads_found: 25,
          leads_new: 11,
          estimated_cost_usd: 2.5,
        },
      ],
      leads: [{ id: "lead-1", niche: "restaurant", address: "Pocitos, Montevideo, Uruguay" }],
      filters: { niche: "restaurant", barrio: "Pocitos", limit: 10 },
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.catalog_entry.location_key).toBe("pocitos");
    expect(suggestions[0]?.historical_metrics.historical_scope).toBe("parent");
    expect(suggestions[0]?.confidence).toBe("low");
  });
});
