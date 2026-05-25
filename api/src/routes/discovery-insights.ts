const SUPPORTED_DISCOVERY_SOURCES = ["mintur", "osm", "yelu", "pedidosya", "google_places"] as const;

export type SupportedDiscoverySource = (typeof SUPPORTED_DISCOVERY_SOURCES)[number];

export type LeadInsightRow = {
  id: string;
  source: string | null;
  niche: string | null;
  address: string | null;
  prospect_score: number | null;
  contact_tier: string | null;
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

export type GranularLocationDensityPoint = {
  location_key: string;
  location_label: string;
  parent_location_key: string;
  parent_location_label: string;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
  commercial_density_score: number;
  gps_points: Array<{ lat: number; lng: number }>;
  raw_gps_lead_count: number;
  geocoded_lead_count: number;
  grid_center: { lat: number; lng: number };
};

export type LeadDensityGpsSource = "real" | "inferred" | "google";

export type LeadDensityFilters = {
  sources?: string[];
  niche?: string | null;
  prospect_score_gte?: number | null;
  contact_tiers?: string[];
  gps_sources?: LeadDensityGpsSource[];
};

export type LeadDensityMeta = {
  raw_gps_leads: number;
  geocoded_address_leads: number;
  unresolved_address_leads: number;
  deferred_geocode_leads: number;
  filtered_leads: number;
  positioned_leads: number;
  grid_cell_size_km: number;
};

export type LeadDensitySnapshot = {
  locations: GranularLocationDensityPoint[];
  exact_points: Array<{ lat: number; lng: number }>;
  geocoded_points: Array<{ lat: number; lng: number }>;
  meta: LeadDensityMeta;
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

function normalizeSearchText(value: string | null | undefined): string {
  return stripDiacritics(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

function parseEwkbHexPoint(hex: string): { lat: number; lng: number } | null {
  if (hex.length < 50) return null;
  // EWKB Point with SRID (little-endian):
  // byte 0      = endianness (1 = LE, PostGIS default)
  // bytes 1-4   = geometry type (with SRID flag)
  // bytes 5-8   = SRID
  // bytes 9-16  = X (longitude) as double
  // bytes 17-24 = Y (latitude) as double
  try {
    const buf = Buffer.from(hex, "hex");
    if (buf.length < 25) return null;
    const byteOrder = buf.readUInt8(0);
    if (byteOrder !== 1) return null;
    const lng = buf.readDoubleLE(9);
    const lat = buf.readDoubleLE(17);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function extractGpsPoints(gps: unknown): Array<{ lat: number; lng: number }> {
  // PostGIS geography column comes as EWKB hex string via PostgREST.
  if (typeof gps === "string") {
    const point = parseEwkbHexPoint(gps);
    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat !== 0 && point.lng !== 0) {
      return [point];
    }
    return [];
  }
  // Fallback for JSON-shape objects (legacy callers / tests).
  if (gps && typeof gps === "object") {
    const maybe = gps as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
    const lat = asNumber(maybe.lat ?? maybe.latitude);
    const lng = asNumber(maybe.lng ?? maybe.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return [];
    return [{ lat, lng }];
  }
  return [];
}

function percentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length <= 1) return 100;
  const lastIndex = sortedValues.lastIndexOf(value);
  if (lastIndex < 0) return 0;
  return (lastIndex / (sortedValues.length - 1)) * 100;
}

const HEATMAP_GRID_STEP_DEGREES = 0.02;
const HEATMAP_GRID_SIZE_KM = 2.2;
const DEFAULT_GEOCODE_LIMIT = 120;

type DensityCoordinate = {
  lat: number;
  lng: number;
  source: "gps" | "geocoded";
};

function buildGridCell(point: { lat: number; lng: number }, step = HEATMAP_GRID_STEP_DEGREES) {
  const latIndex = Math.floor(point.lat / step);
  const lngIndex = Math.floor(point.lng / step);
  const center = {
    lat: Number((latIndex * step + step / 2).toFixed(5)),
    lng: Number((lngIndex * step + step / 2).toFixed(5)),
  };
  return {
    gridKey: `${latIndex}:${lngIndex}`,
    center,
    label: `Cuadrícula ${center.lat.toFixed(2)} / ${center.lng.toFixed(2)}`,
  };
}

function getPrimaryCoordinate(lead: LeadInsightRow): DensityCoordinate | null {
  const [firstPoint] = extractGpsPoints(lead.gps);
  if (!firstPoint) return null;
  return { ...firstPoint, source: "gps" };
}

function normalizeContactTier(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
}

function resolveRawGpsSource(lead: LeadInsightRow): Exclude<LeadDensityGpsSource, "inferred"> {
  const sources = extractSources(lead.source, lead.corroborating_sources);
  return sources.includes("google_places") ? "google" : "real";
}

function matchesLeadDensityFilters(
  lead: LeadInsightRow,
  filters: LeadDensityFilters,
  rawCoordinate: DensityCoordinate | null
): boolean {
  if (filters.sources && filters.sources.length > 0) {
    const leadSource = lead.source?.trim();
    if (!leadSource || !filters.sources.includes(leadSource)) return false;
  }

  if (filters.niche) {
    const haystack = normalizeSearchText(lead.niche);
    if (!haystack.includes(normalizeSearchText(filters.niche))) return false;
  }

  if (filters.prospect_score_gte != null && asNumber(lead.prospect_score) < filters.prospect_score_gte) {
    return false;
  }

  if (filters.contact_tiers && filters.contact_tiers.length > 0) {
    const tier = normalizeContactTier(lead.contact_tier);
    if (!tier || !filters.contact_tiers.includes(tier)) return false;
  }

  if (filters.gps_sources && filters.gps_sources.length > 0) {
    if (!rawCoordinate) return filters.gps_sources.includes("inferred");
    return filters.gps_sources.includes(resolveRawGpsSource(lead));
  }

  return true;
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

export async function buildLeadDensitySnapshot(
  leads: LeadInsightRow[],
  options: {
    locationFilter?: string | null;
    filters?: LeadDensityFilters;
    geocodeAddress?: (address: string) => Promise<{ lat: number; lng: number } | null>;
    maxGeocodes?: number;
  } = {}
): Promise<LeadDensitySnapshot> {
  const grouped = new Map<string, GranularLocationDensityPoint>();
  const normalizedFilter = options.locationFilter ? buildLocationKey(options.locationFilter) : null;
  const geocodeAddress = options.geocodeAddress;
  const maxGeocodes = Math.max(0, options.maxGeocodes ?? DEFAULT_GEOCODE_LIMIT);
  const filters: LeadDensityFilters = {
    sources: options.filters?.sources?.map((value) => value.trim()).filter(Boolean),
    niche: options.filters?.niche?.trim() || null,
    prospect_score_gte: options.filters?.prospect_score_gte ?? null,
    contact_tiers: options.filters?.contact_tiers?.map((value) => value.trim().toUpperCase()).filter(Boolean),
    gps_sources: options.filters?.gps_sources?.filter(Boolean),
  };

  const scopedLeads = leads
    .map((lead) => {
      const parentLocationLabel = deriveLocationLabelFromAddress(lead.address);
      const parentLocationKey = buildLocationKey(parentLocationLabel);
      const rawCoordinate = getPrimaryCoordinate(lead);
      return { lead, parentLocationLabel, parentLocationKey, rawCoordinate };
    })
    .filter((entry) => (!normalizedFilter || entry.parentLocationKey === normalizedFilter) && matchesLeadDensityFilters(entry.lead, filters, entry.rawCoordinate));

  const geocodingCandidates = scopedLeads.filter(
    (entry) => !entry.rawCoordinate && typeof entry.lead.address === "string" && entry.lead.address.trim() !== ""
  );

  const attemptedGeocodeCandidates = geocodingCandidates.slice(0, maxGeocodes);
  const attemptedGeocodeLeadIds = new Set(attemptedGeocodeCandidates.map((entry) => entry.lead.id));
  const deferredGeocodeLeads = Math.max(0, geocodingCandidates.length - attemptedGeocodeCandidates.length);
  const geocodedByLeadId = new Map<string, { lat: number; lng: number }>();
  if (geocodeAddress) {
    for (const entry of attemptedGeocodeCandidates) {
      const point = await geocodeAddress(entry.lead.address ?? "");
      if (point) geocodedByLeadId.set(entry.lead.id, point);
    }
  }

  let rawGpsLeads = 0;
  let geocodedAddressLeads = 0;
  let unresolvedAddressLeads = 0;
  let filteredLeads = scopedLeads.length;
  let positionedLeads = 0;
  const exactPoints: Array<{ lat: number; lng: number }> = [];
  const geocodedPoints: Array<{ lat: number; lng: number }> = [];

  for (const entry of scopedLeads) {
    const score = asNumber(entry.lead.prospect_score);
    const rawCoordinate = entry.rawCoordinate;
    const geocodedCoordinate = geocodedByLeadId.get(entry.lead.id);
    const coordinate = rawCoordinate ?? (geocodedCoordinate ? { ...geocodedCoordinate, source: "geocoded" as const } : null);

    if (!coordinate) {
      if (typeof entry.lead.address === "string" && entry.lead.address.trim() !== "" && attemptedGeocodeLeadIds.has(entry.lead.id)) {
        unresolvedAddressLeads += 1;
      }
      continue;
    }

    positionedLeads += 1;
    const cell = buildGridCell(coordinate);
    const locationKey = `${entry.parentLocationKey || "sin-ubicacion"}::${cell.gridKey}`;
    const locationLabel = `${entry.parentLocationLabel} · ${cell.label}`;
    const current = grouped.get(locationKey) ?? {
      location_key: locationKey,
      location_label: locationLabel,
      parent_location_key: entry.parentLocationKey,
      parent_location_label: entry.parentLocationLabel,
      lead_count: 0,
      hot_leads_count: 0,
      avg_prospect_score: 0,
      commercial_density_score: 0,
      gps_points: [],
      raw_gps_lead_count: 0,
      geocoded_lead_count: 0,
      grid_center: cell.center,
    };

    current.lead_count += 1;
    current.avg_prospect_score += score;
    if (score >= 55) current.hot_leads_count += 1;
    current.gps_points.push({ lat: coordinate.lat, lng: coordinate.lng });

    if (coordinate.source === "gps") {
      current.raw_gps_lead_count += 1;
      rawGpsLeads += 1;
      exactPoints.push({ lat: coordinate.lat, lng: coordinate.lng });
    } else {
      current.geocoded_lead_count += 1;
      geocodedAddressLeads += 1;
      geocodedPoints.push({ lat: coordinate.lat, lng: coordinate.lng });
    }

    grouped.set(locationKey, current);
  }

  const rows = [...grouped.values()].map((row) => ({
    ...row,
    avg_prospect_score: row.lead_count > 0 ? Number((row.avg_prospect_score / row.lead_count).toFixed(2)) : 0,
  }));

  const locations = computeDensityScores(rows).sort((left, right) => {
    if (right.commercial_density_score !== left.commercial_density_score) {
      return right.commercial_density_score - left.commercial_density_score;
    }
    if (right.lead_count !== left.lead_count) return right.lead_count - left.lead_count;
    return left.location_label.localeCompare(right.location_label);
  });

  return {
    locations,
    exact_points: exactPoints,
    geocoded_points: geocodedPoints,
    meta: {
      raw_gps_leads: rawGpsLeads,
      geocoded_address_leads: geocodedAddressLeads,
      unresolved_address_leads: unresolvedAddressLeads,
      deferred_geocode_leads: deferredGeocodeLeads,
      filtered_leads: filteredLeads,
      positioned_leads: positionedLeads,
      grid_cell_size_km: HEATMAP_GRID_SIZE_KM,
    },
  };
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
