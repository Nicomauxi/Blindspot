import { describe, expect, it } from "vitest";
import {
  buildNicheSuggestionTooltip,
  parseDiscoveryComposerDraft,
  type DiscoveryComposerDraft,
} from "../../ui/src/lib/discovery-workspace";

const fallback: DiscoveryComposerDraft = {
  sources: ["yelu", "mintur"],
  location: "Montevideo",
  niche: "",
  max_results: "200",
  cpu_budget: "balanced",
  google_profile: "B",
  google_concurrency: "5",
  google_cost_cap_usd: "",
  enrich_after_discovery: true,
};

describe("discovery workspace helpers", () => {
  it("restores a saved composer draft safely", () => {
    const restored = parseDiscoveryComposerDraft(
      JSON.stringify({
        location: "Canelones",
        niche: "hotel",
        sources: ["google_places", "osm"],
        max_results: "400",
        enrich_after_discovery: false,
      }),
      fallback
    );

    expect(restored.location).toBe("Canelones");
    expect(restored.niche).toBe("hotel");
    expect(restored.sources).toEqual(["google_places", "osm"]);
    expect(restored.cpu_budget).toBe("balanced");
    expect(restored.enrich_after_discovery).toBe(false);
  });

  it("builds a tooltip breakdown per source for niche suggestions", () => {
    const tooltip = buildNicheSuggestionTooltip(
      { key: "restaurant", niche: "restaurant", origin: "existing_leads", count: 12 },
      [
        { source: "yelu", niches: [{ niche: "restaurant", count: 7 }] },
        { source: "mintur", niches: [{ niche: "restaurant", count: 3 }] },
        { source: "osm", niches: [{ niche: "hotel", count: 5 }] },
      ]
    );

    expect(tooltip).toBe("yelu: 7 · mintur: 3");
  });
});
