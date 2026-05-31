import { describe, expect, it } from "vitest";
import type { DiscoveryLocationSuggestion, DiscoveryPlaceCatalogEntry } from "../../ui/src/lib/api";
import {
  buildPredictiveContext,
  buildRecommendationOrigin,
  catalogEntryToSelection,
  freeTextToSelection,
  slugifyLocation,
  suggestionToSelection,
  toggleSelection,
} from "../../ui/src/lib/discovery-location";

const catalogEntry: DiscoveryPlaceCatalogEntry = {
  id: "catalog-pocitos",
  location_key: "pocitos",
  display_name: "Pocitos",
  parent_location: "Montevideo",
  kind: "barrio",
  lat_approx: -34.91,
  lng_approx: -56.15,
  commercial_score: 92,
  notes: null,
  source: "xls_import",
  imported_at: "2026-05-27T00:00:00Z",
};

const suggestion: DiscoveryLocationSuggestion = {
  catalog_entry: catalogEntry,
  niche: "restaurant",
  score: 81,
  confidence: "medium",
  expected_new_leads: 4.2,
  duplicate_risk: 0.22,
  cost_estimate: 1.45,
  reasons: ["Cobertura actual baja."],
  historical_metrics: {
    jobs_count: 2,
    candidates_seen: 32,
    new_leads_count: 10,
    duplicate_count: 7,
    success_rate: 0.31,
    duplicate_rate: 0.22,
    avg_cost_per_new_lead: 0.35,
    last_discovery_at: "2026-03-20T10:00:00Z",
    coverage_lead_count: 1,
    historical_scope: "parent",
    inherited_from: ["Montevideo"],
  },
};

describe("discovery-location helpers", () => {
  it("convierte una entrada del catálogo a selección", () => {
    const selection = catalogEntryToSelection(catalogEntry);
    expect(selection).toMatchObject({
      key: "pocitos",
      display_name: "Pocitos",
      kind: "barrio",
      parent_location: "Montevideo",
      commercial_score: 92,
      source: "catalog",
      catalog_entry_id: "catalog-pocitos",
      suggestion: null,
    });
  });

  it("convierte una sugerencia predictiva conservando el snapshot", () => {
    const selection = suggestionToSelection(suggestion);
    expect(selection.source).toBe("predictive");
    expect(selection.catalog_entry_id).toBe("catalog-pocitos");
    expect(selection.suggestion).toBe(suggestion);
  });

  it("crea una selección freetext con key slugificada", () => {
    const selection = freeTextToSelection("  Punta del Este ");
    expect(selection.display_name).toBe("Punta del Este");
    expect(selection.key).toBe("freetext:punta-del-este");
    expect(selection.source).toBe("freetext");
    expect(selection.catalog_entry_id).toBeNull();
  });

  it("slugifyLocation normaliza acentos y separadores", () => {
    expect(slugifyLocation("Tacuarembó")).toBe("tacuarembo");
    expect(slugifyLocation("Av. 18 de Julio")).toBe("av-18-de-julio");
  });

  it("buildPredictiveContext solo aplica a selecciones predictivas", () => {
    expect(buildPredictiveContext(catalogEntryToSelection(catalogEntry))).toBeUndefined();
    expect(buildPredictiveContext(freeTextToSelection("Salto"))).toBeUndefined();
    const context = buildPredictiveContext(suggestionToSelection(suggestion));
    expect(context).toEqual({
      suggestion_source: "predictive_location",
      location_catalog_entry_id: "catalog-pocitos",
      opportunity_score_snapshot: suggestion,
    });
  });

  it("buildRecommendationOrigin distingue predictivo de manual", () => {
    expect(buildRecommendationOrigin(suggestionToSelection(suggestion))).toEqual({
      type: "predictive_location",
      key: "pocitos",
    });
    expect(buildRecommendationOrigin(freeTextToSelection("Salto"), "Gap Salto")).toEqual({
      type: "manual",
      key: "Gap Salto",
    });
    expect(buildRecommendationOrigin(null)).toEqual({ type: "manual" });
  });

  it("toggleSelection respeta single y multi", () => {
    const a = catalogEntryToSelection(catalogEntry);
    const b = freeTextToSelection("Salto");

    // single reemplaza
    expect(toggleSelection([], a, "single")).toEqual([a]);
    expect(toggleSelection([a], b, "single")).toEqual([b]);
    // single deselecciona al re-togglear la misma
    expect(toggleSelection([a], a, "single")).toEqual([]);

    // multi agrega/quita
    expect(toggleSelection([], a, "multi")).toEqual([a]);
    expect(toggleSelection([a], b, "multi")).toEqual([a, b]);
    expect(toggleSelection([a, b], a, "multi")).toEqual([b]);
  });
});
