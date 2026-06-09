import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiscoveryGeoFilterQuery } from "../../ui/src/lib/api";
import {
  NICHE_MARKER_ICON_OPTIONS,
  buildComposerGeoSelection,
  buildLeadExplorerGeoHref,
  buildZoneLeadRequest,
  computeLocationCentroid,
  countLocationPoints,
  filterAndSortLocations,
  parseGranularLocationKey,
  resolveCanonicalNiche,
  resolveLeadMarkerIcon,
} from "../../ui/src/lib/location-density-map";
import type { DiscoveryMapDensityLocation, NicheAliasGroup } from "../../ui/src/lib/api";

const repoRoot = path.resolve(__dirname, "../..");

const nicheGroups: NicheAliasGroup[] = [
  { id: "niche-1", canonical: "restaurant", aliases: ["restaurante", "parrilla"], created_at: "2026-05-27T00:00:00Z", updated_at: "2026-05-27T00:00:00Z" },
];

const locations: DiscoveryMapDensityLocation[] = [
  {
    location_key: "montevideo-centro::a",
    location_label: "Montevideo Centro · Cuadrícula -34.91 / -56.19",
    parent_location_key: "montevideo-centro",
    parent_location_label: "Montevideo Centro",
    lead_count: 18,
    hot_leads_count: 5,
    avg_prospect_score: 62.4,
    commercial_density_score: 91,
    gps_points: [
      { lat: -34.905, lng: -56.191 },
      { lat: -34.901, lng: -56.188 },
    ],
    raw_gps_lead_count: 2,
    geocoded_lead_count: 1,
    grid_center: { lat: -34.903, lng: -56.1895 },
  },
  {
    location_key: "canelones-sur::b",
    location_label: "Canelones Sur · Cuadrícula -34.71 / -56.21",
    parent_location_key: "canelones-sur",
    parent_location_label: "Canelones Sur",
    lead_count: 24,
    hot_leads_count: 3,
    avg_prospect_score: 58.1,
    commercial_density_score: 79,
    gps_points: [{ lat: -34.72, lng: -56.22 }],
    raw_gps_lead_count: 1,
    geocoded_lead_count: 0,
    grid_center: { lat: -34.71, lng: -56.21 },
  },
  {
    location_key: "punta-del-este::c",
    location_label: "Punta del Este · Cuadrícula -34.95 / -54.95",
    parent_location_key: "punta-del-este",
    parent_location_label: "Punta del Este",
    lead_count: 10,
    hot_leads_count: 7,
    avg_prospect_score: 74.3,
    commercial_density_score: 88,
    gps_points: [],
    raw_gps_lead_count: 0,
    geocoded_lead_count: 2,
    grid_center: { lat: -34.95, lng: -54.95 },
  },
];

describe("location density map helpers", () => {
  it("filters by zone or parent location label and sorts by the requested metric", () => {
    const filtered = filterAndSortLocations(locations, "sur", "leads");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.location_key).toBe("canelones-sur::b");
  });

  it("sorts by density by default and uses label as deterministic tiebreaker", () => {
    const sorted = filterAndSortLocations(locations, "", "density");

    expect(sorted.map((location) => location.location_key)).toEqual([
      "montevideo-centro::a",
      "punta-del-este::c",
      "canelones-sur::b",
    ]);
  });

  it("uses grid center as centroid and counts plotted points", () => {
    expect(countLocationPoints(locations[0]!)).toBe(2);
    const centroid = computeLocationCentroid(locations[0]!);
    expect(centroid).not.toBeNull();
    expect(centroid?.lat).toBeCloseTo(-34.903, 6);
    expect(centroid?.lng).toBeCloseTo(-56.1895, 6);
    expect(computeLocationCentroid(locations[2]!)).toEqual({ lat: -34.95, lng: -54.95 });
  });

  it("builds structured Lead Explorer links from granular keys", () => {
    expect(parseGranularLocationKey(locations[0]!.location_key)).toEqual({
      parentLocationKey: "montevideo-centro",
      gridLocationKey: "a",
    });
    expect(buildLeadExplorerGeoHref(locations[0]!)).toBe(
      "/admin/leads?parent_location_keys=montevideo-centro&grid_location_keys=a"
    );
  });

  it("serializes the shared geo filter contract consistently for density and zone drilldown requests", () => {
    const query = buildDiscoveryGeoFilterQuery({
      source: ["yelu", "osm"],
      niche: "restaurant",
      prospect_score_gte: 70,
      contact_tier: ["A", "B"],
      gps_source: ["google"],
      zone_ids: ["montevideo", "pocitos"],
      limit: 30,
    });

    expect(query.toString()).toBe("source=yelu%2Cosm&niche=restaurant&prospect_score_gte=70&contact_tier=A%2CB&gps_source=google&zone_ids=montevideo%2Cpocitos&limit=30");
  });

  it("reuses the same shared geo contracts for composer prefill and zone drilldown", () => {
    expect(buildComposerGeoSelection(locations[0]!)).toEqual({
      label: "Montevideo Centro · Cuadrícula -34.91 / -56.19",
      parent_location_keys: ["montevideo-centro"],
      grid_location_keys: ["a"],
    });
    expect(buildZoneLeadRequest(locations[0]!)).toEqual({
      location_key: "montevideo-centro::a",
      parent_location_key: "montevideo-centro",
      grid_location_key: "a",
      limit: 200,
    });
  });

  it("resolves canonical niches and marker icons consistently", () => {
    expect(resolveCanonicalNiche("restaurante", nicheGroups)).toBe("restaurant");
    expect(resolveLeadMarkerIcon({ niche: "restaurante" }, nicheGroups, {}).key).toBe("food");
    expect(resolveLeadMarkerIcon({ niche: "restaurante" }, nicheGroups, { restaurant: "beauty" }).key).toBe("beauty");
    expect(NICHE_MARKER_ICON_OPTIONS.some((option) => option.key === "automotive")).toBe(true);
  });

  it("keeps both screens mounted on the same shared cartographic base via thin wrappers", () => {
    const leadPage = fs.readFileSync(path.join(repoRoot, "ui/src/app/admin/page.tsx"), "utf8");
    // Discovery se absorbió en Operaciones: el mapa vive en el componente discovery-ops.
    const discoveryOps = fs.readFileSync(path.join(repoRoot, "ui/src/components/operations/discovery-ops.tsx"), "utf8");
    const leadWrapper = fs.readFileSync(path.join(repoRoot, "ui/src/components/lead-review-map.tsx"), "utf8");
    const discoveryWrapper = fs.readFileSync(path.join(repoRoot, "ui/src/components/discovery-context-map.tsx"), "utf8");

    expect(leadPage).toContain('import { LeadReviewMap } from "@/components/lead-review-map";');
    expect(leadPage).toContain("<LeadReviewMap");
    expect(discoveryOps).toContain('import { DiscoveryContextMap } from "@/components/discovery-context-map";');
    expect(discoveryOps).toContain("<DiscoveryContextMap");
    expect(leadWrapper).toContain('module.LocationDensityMapBase');
    expect(leadWrapper).toContain('ssr: false');
    expect(leadWrapper).toContain('variant="lead-review"');
    expect(discoveryWrapper).toContain('module.LocationDensityMapBase');
    expect(discoveryWrapper).toContain('ssr: false');
    expect(discoveryWrapper).toContain('variant="discovery-context"');
  });
});
