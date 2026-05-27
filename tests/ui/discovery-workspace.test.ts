import { describe, expect, it } from "vitest";
import { parseDiscoveryComposerDraft, type DiscoveryComposerDraft } from "../../ui/src/lib/discovery-workspace";

const fallback: DiscoveryComposerDraft = {
  sources: ["yelu"],
  location: "Montevideo",
  niche: "",
  max_results: "200",
  cpu_budget: "balanced",
  google_profile: "B",
  google_concurrency: "5",
  google_cost_cap_usd: "",
  enrich_after_discovery: true,
  geo_selection: undefined,
};

describe("discovery workspace draft", () => {
  it("restores structured geo selection from persisted composer drafts", () => {
    const draft = parseDiscoveryComposerDraft(
      JSON.stringify({
        ...fallback,
        location: "Montevideo",
        geo_selection: {
          label: "Montevideo Centro · Cuadrícula -34.90 / -56.19",
          parent_location_keys: ["montevideo-centro"],
          grid_location_keys: ["a"],
        },
      }),
      fallback
    );

    expect(draft.geo_selection).toEqual({
      label: "Montevideo Centro · Cuadrícula -34.90 / -56.19",
      parent_location_keys: ["montevideo-centro"],
      grid_location_keys: ["a"],
    });
  });

  it("drops malformed geo selection payloads and keeps the fallback shape", () => {
    const draft = parseDiscoveryComposerDraft(
      JSON.stringify({
        ...fallback,
        geo_selection: {
          label: 99,
          parent_location_keys: ["montevideo-centro"],
        },
      }),
      fallback
    );

    expect(draft.geo_selection).toBeUndefined();
    expect(draft.location).toBe("Montevideo");
  });
});
