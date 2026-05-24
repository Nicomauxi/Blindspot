import type { DiscoveryRecommendationData } from "@/lib/api";

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
