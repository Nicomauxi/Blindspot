const SUPPORTED_DISCOVERY_SOURCES = ["mintur", "osm", "yelu", "pedidosya", "google_places"] as const;

export type SupportedDiscoverySource = (typeof SUPPORTED_DISCOVERY_SOURCES)[number];

export type LeadInsightRow = {
  id: string;
  source: string | null;
  niche: string | null;
  address: string | null;
  prospect_score: number | null;
  gps: unknown;
  corroborating_sources: unknown;
};

export type DiscoveryJobInsightRow = {
  source: string | null;
  niche: string | null;
  location: string | null;
  created_at: string;
};

export type GooglePlacesBudgetRow = {
  google_places_budget_total: number;
  google_places_budget_spent: number;
  google_places_alert_threshold: number;
};

export type CompletedRunInsightRow = {
  finished_at: string | null;
  stats: Record<string, unknown> | null;
};

export type LocationDensityPoint = {
  location_key: string;
  location_label: string;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
  commercial_density_score: number;
  gps_points: Array<{ lat: number; lng: number }>;
};

export type CoverageGap = {
  key: string;
  location_key: string;
  location_label: string;
  niche: string;
  present_sources: string[];
  missing_sources: string[];
  commercial_density_score: number;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
};

export type NicheSuggestion = {
  key: string;
  niche: string;
  origin: "recent_discovery" | "existing_leads" | "top_by_source";
  source?: string;
  count?: number;
};

export type DiscoveryRecommendations = {
  coverage_gaps_global: CoverageGap[];
  coverage_gaps_by_location: Array<{
    location_key: string;
    location_label: string;
    commercial_density_score: number;
    gaps: CoverageGap[];
  }>;
  niche_suggestions: NicheSuggestion[];
  top_niches_by_source: Array<{ source: string; niches: Array<{ niche: string; count: number }> }>;
  google_places_budget: {
    budget_total: number;
    budget_spent: number;
    budget_remaining: number;
    alert_threshold: number;
    over_alert: boolean;
  } | null;
  monthly_cost: number;
  location_density: LocationDensityPoint[];
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeLocationLabel(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "Sin ubicación";

  const cleaned = stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, " ")
    .replace(/\b(uruguay|uy|departamento|depto|ciudad)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return titleCase(cleaned || raw);
}

function buildLocationKey(input: string | null | undefined): string {
  return normalizeLocationLabel(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveLocationLabelFromAddress(address: string | null | undefined): string {
  const raw = (address ?? "").trim();
  if (!raw) return "Sin ubicación";

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
    const normalized = normalizeLocationLabel(parts[idx]);
    const key = buildLocationKey(normalized);
    if (normalized && normalized !== "Sin ubicación" && key !== "uruguay" && key !== "") {
      return normalized;
    }
  }

  return normalizeLocationLabel(raw);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function extractSources(source: string | null, corroboratingSources: unknown): string[] {
  const values = new Set<string>();
  if (source && SUPPORTED_DISCOVERY_SOURCES.includes(source as SupportedDiscoverySource)) {
    values.add(source);
  }

  if (Array.isArray(corroboratingSources)) {
    for (const item of corroboratingSources) {
      const entry = item as { source?: unknown };
      if (typeof entry.source === "string" && SUPPORTED_DISCOVERY_SOURCES.includes(entry.source as SupportedDiscoverySource)) {
        values.add(entry.source);
      }
    }
  }

  return [...values];
}

function extractGpsPoints(gps: unknown): Array<{ lat: number; lng: number }> {
  if (!gps || typeof gps !== "object") return [];
  const maybe = gps as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
  const lat = asNumber(maybe.lat ?? maybe.latitude);
  const lng = asNumber(maybe.lng ?? maybe.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return [];
  return [{ lat, lng }];
}

function percentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length <= 1) return 100;
  const lastIndex = sortedValues.lastIndexOf(value);
  if (lastIndex < 0) return 0;
  return (lastIndex / (sortedValues.length - 1)) * 100;
}

function computeDensityScores(points: LocationDensityPoint[]): LocationDensityPoint[] {
  const leadCounts = [...points.map((point) => point.lead_count)].sort((a, b) => a - b);
  const hotCounts = [...points.map((point) => point.hot_leads_count)].sort((a, b) => a - b);
  const avgScores = [...points.map((point) => point.avg_prospect_score)].sort((a, b) => a - b);

  return points.map((point) => ({
    ...point,
    commercial_density_score: Math.round(
      percentile(point.lead_count, leadCounts) * 0.5 +
      percentile(point.hot_leads_count, hotCounts) * 0.3 +
      percentile(point.avg_prospect_score, avgScores) * 0.2
    ),
  }));
}

export function buildLeadDensityRows(leads: LeadInsightRow[], locationFilter?: string | null): LocationDensityPoint[] {
  const grouped = new Map<string, LocationDensityPoint>();
  const normalizedFilter = locationFilter ? buildLocationKey(locationFilter) : null;

  for (const lead of leads) {
    const locationLabel = deriveLocationLabelFromAddress(lead.address);
    const locationKey = buildLocationKey(locationLabel);
    if (normalizedFilter && locationKey !== normalizedFilter) continue;

    const current = grouped.get(locationKey) ?? {
      location_key: locationKey,
      location_label: locationLabel,
      lead_count: 0,
      hot_leads_count: 0,
      avg_prospect_score: 0,
      commercial_density_score: 0,
      gps_points: [],
    };

    current.lead_count += 1;
    if (asNumber(lead.prospect_score) >= 55) current.hot_leads_count += 1;
    current.avg_prospect_score += asNumber(lead.prospect_score);
    current.gps_points.push(...extractGpsPoints(lead.gps));
    grouped.set(locationKey, current);
  }

  const rows = [...grouped.values()].map((row) => ({
    ...row,
    avg_prospect_score: row.lead_count > 0 ? Number((row.avg_prospect_score / row.lead_count).toFixed(2)) : 0,
  }));

  return computeDensityScores(rows).sort((left, right) => {
    if (right.commercial_density_score !== left.commercial_density_score) {
      return right.commercial_density_score - left.commercial_density_score;
    }
    return right.lead_count - left.lead_count;
  });
}

export function buildDiscoveryRecommendations(params: {
  leads: LeadInsightRow[];
  discoveryJobs: DiscoveryJobInsightRow[];
  budget: GooglePlacesBudgetRow | null;
  completedRuns: CompletedRunInsightRow[];
  selectedSources?: string[];
  location?: string | null;
  niche?: string | null;
  limit?: number;
}): DiscoveryRecommendations {
  const { leads, discoveryJobs, budget, completedRuns } = params;
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const locationFilter = params.location ? buildLocationKey(params.location) : null;
  const nicheFilter = params.niche?.trim().toLowerCase() ?? null;
  const selectedSources = (params.selectedSources?.filter((source) => SUPPORTED_DISCOVERY_SOURCES.includes(source as SupportedDiscoverySource)) ?? [...SUPPORTED_DISCOVERY_SOURCES]);
  const density = buildLeadDensityRows(leads, params.location ?? null);
  const densityByLocation = new Map(density.map((row) => [row.location_key, row]));

  const combos = new Map<string, CoverageGap & { source_set: Set<string> }>();
  const recentNiches = new Map<string, number>();
  const existingLeadNiches = new Map<string, number>();
  const topNichesBySourceMap = new Map<string, Map<string, number>>();

  for (const job of discoveryJobs) {
    const niche = (job.niche ?? "").trim();
    if (!niche) continue;
    recentNiches.set(niche, (recentNiches.get(niche) ?? 0) + 1);
  }

  for (const lead of leads) {
    const niche = (lead.niche ?? "").trim();
    if (!niche) continue;

    const locationLabel = deriveLocationLabelFromAddress(lead.address);
    const locationKey = buildLocationKey(locationLabel);
    if (locationFilter && locationKey !== locationFilter) continue;
    if (nicheFilter && niche.toLowerCase() !== nicheFilter) continue;

    existingLeadNiches.set(niche, (existingLeadNiches.get(niche) ?? 0) + 1);

    const comboKey = `${locationKey}::${niche.toLowerCase()}`;
    const combo = combos.get(comboKey) ?? {
      key: comboKey,
      location_key: locationKey,
      location_label: locationLabel,
      niche,
      present_sources: [],
      missing_sources: [],
      commercial_density_score: densityByLocation.get(locationKey)?.commercial_density_score ?? 0,
      lead_count: 0,
      hot_leads_count: 0,
      avg_prospect_score: 0,
      source_set: new Set<string>(),
    };

    combo.lead_count += 1;
    combo.avg_prospect_score += asNumber(lead.prospect_score);
    if (asNumber(lead.prospect_score) >= 55) combo.hot_leads_count += 1;

    for (const source of extractSources(lead.source, lead.corroborating_sources)) {
      combo.source_set.add(source);
      const sourceMap = topNichesBySourceMap.get(source) ?? new Map<string, number>();
      sourceMap.set(niche, (sourceMap.get(niche) ?? 0) + 1);
      topNichesBySourceMap.set(source, sourceMap);
    }

    combos.set(comboKey, combo);
  }

  const coverageGaps = [...combos.values()]
    .map((combo) => {
      const presentSources = selectedSources.filter((source) => combo.source_set.has(source));
      const missingSources = selectedSources.filter((source) => !combo.source_set.has(source));
      return {
        ...combo,
        present_sources: presentSources,
        missing_sources: missingSources,
        avg_prospect_score: combo.lead_count > 0 ? Number((combo.avg_prospect_score / combo.lead_count).toFixed(2)) : 0,
      };
    })
    .filter((combo) => combo.present_sources.length > 0 && combo.missing_sources.length > 0)
    .sort((left, right) => {
      if (right.commercial_density_score !== left.commercial_density_score) {
        return right.commercial_density_score - left.commercial_density_score;
      }
      if (right.lead_count !== left.lead_count) return right.lead_count - left.lead_count;
      return left.key.localeCompare(right.key);
    })
    .slice(0, limit)
    .map(({ source_set: _ignored, ...gap }) => gap);

  const groupedByLocation = new Map<string, { location_key: string; location_label: string; commercial_density_score: number; gaps: CoverageGap[] }>();
  for (const gap of coverageGaps) {
    const group = groupedByLocation.get(gap.location_key) ?? {
      location_key: gap.location_key,
      location_label: gap.location_label,
      commercial_density_score: gap.commercial_density_score,
      gaps: [],
    };
    group.gaps.push(gap);
    groupedByLocation.set(gap.location_key, group);
  }

  const topNichesBySource = selectedSources.map((source) => ({
    source,
    niches: [...(topNichesBySourceMap.get(source)?.entries() ?? [])]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([niche, count]) => ({ niche, count })),
  }));

  const nicheSuggestions: NicheSuggestion[] = [
    ...[...recentNiches.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([niche, count]) => ({ key: `recent:${niche}`, niche, origin: "recent_discovery" as const, count })),
    ...[...existingLeadNiches.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([niche, count]) => ({ key: `lead:${niche}`, niche, origin: "existing_leads" as const, count })),
    ...topNichesBySource.flatMap((entry) =>
      entry.niches.map((nicheEntry) => ({
        key: `source:${entry.source}:${nicheEntry.niche}`,
        niche: nicheEntry.niche,
        origin: "top_by_source" as const,
        source: entry.source,
        count: nicheEntry.count,
      }))
    ),
  ].filter((suggestion, index, array) => array.findIndex((entry) => entry.key === suggestion.key) === index).slice(0, 18);

  const monthlyCost = completedRuns
    .filter((run) => typeof run.finished_at === "string" && run.finished_at.slice(0, 7) === new Date().toISOString().slice(0, 7))
    .reduce((sum, run) => sum + asNumber(run.stats?.["estimated_cost_usd"]), 0);

  return {
    coverage_gaps_global: coverageGaps,
    coverage_gaps_by_location: [...groupedByLocation.values()].sort((left, right) => {
      if (right.commercial_density_score !== left.commercial_density_score) {
        return right.commercial_density_score - left.commercial_density_score;
      }
      return left.location_label.localeCompare(right.location_label);
    }),
    niche_suggestions: nicheSuggestions,
    top_niches_by_source: topNichesBySource,
    google_places_budget: budget
      ? {
          budget_total: budget.google_places_budget_total,
          budget_spent: budget.google_places_budget_spent,
          budget_remaining: budget.google_places_budget_total - budget.google_places_budget_spent,
          alert_threshold: budget.google_places_alert_threshold,
          over_alert: budget.google_places_budget_total - budget.google_places_budget_spent < budget.google_places_alert_threshold,
        }
      : null,
    monthly_cost: Number(monthlyCost.toFixed(2)),
    location_density: density.slice(0, limit),
  };
}

export function estimateGooglePlacesBatchCost(maxResults: number): number {
  const safeMaxResults = Math.max(1, Math.min(maxResults, 1000));
  return Math.ceil(safeMaxResults / 20) * 0.035 + safeMaxResults * 0.025;
}

export function supportedDiscoverySources(): string[] {
  return [...SUPPORTED_DISCOVERY_SOURCES];
}
