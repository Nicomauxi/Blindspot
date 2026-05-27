import type { DiscoveryRecommendationData, LeadGeoSelection } from "@/lib/api";

export type DiscoveryComposerGeoSelection = LeadGeoSelection & {
  label: string;
};

export type DiscoveryComposerDraft = {
  sources: string[];
  location: string;
  niche: string;
  max_results: string;
  cpu_budget: "conservative" | "balanced" | "aggressive";
  google_profile: "A" | "B" | "C" | "D";
  google_concurrency: string;
  google_cost_cap_usd: string;
  enrich_after_discovery: boolean;
  geo_selection?: DiscoveryComposerGeoSelection;
};

export const DISCOVERY_COMPOSER_STORAGE_KEY = "blindspot.discovery.composer";

export function parseDiscoveryComposerDraft(
  raw: string | null,
  fallback: DiscoveryComposerDraft
): DiscoveryComposerDraft {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryComposerDraft>;
    return {
      ...fallback,
      ...parsed,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((entry): entry is string => typeof entry === "string")
        : fallback.sources,
      enrich_after_discovery:
        typeof parsed.enrich_after_discovery === "boolean"
          ? parsed.enrich_after_discovery
          : fallback.enrich_after_discovery,
      geo_selection:
        parsed.geo_selection &&
        typeof parsed.geo_selection === "object" &&
        typeof parsed.geo_selection.label === "string"
          ? {
              label: parsed.geo_selection.label,
              parent_location_keys: Array.isArray(parsed.geo_selection.parent_location_keys)
                ? parsed.geo_selection.parent_location_keys.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : undefined,
              grid_location_keys: Array.isArray(parsed.geo_selection.grid_location_keys)
                ? parsed.geo_selection.grid_location_keys.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : undefined,
            }
          : fallback.geo_selection,
    };
  } catch {
    return fallback;
  }
}

export function buildNicheSuggestionTooltip(
  suggestion: DiscoveryRecommendationData["niche_suggestions"][number],
  topNichesBySource: DiscoveryRecommendationData["top_niches_by_source"]
): string | null {
  const matches = topNichesBySource
    .map((sourceGroup) => {
      const match = sourceGroup.niches.find((entry) => entry.niche === suggestion.niche);
      return match ? `${sourceGroup.source}: ${match.count}` : null;
    })
    .filter((value): value is string => value !== null);

  if (matches.length > 0) {
    return matches.join(" · ");
  }

  if (suggestion.source && suggestion.count != null) {
    return `${suggestion.source}: ${suggestion.count}`;
  }

  if (suggestion.count != null) {
    return `Total: ${suggestion.count}`;
  }

  return null;
}
