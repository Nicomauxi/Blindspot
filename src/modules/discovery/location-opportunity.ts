import { buildLocationKey, deriveLocationLabelFromAddress } from "./location.js";

export type OpportunityCatalogEntry = {
  id: string;
  location_key: string;
  display_name: string;
  parent_location: string | null;
  kind: string;
  commercial_score: number | null;
  lat_approx?: number | null;
  lng_approx?: number | null;
  notes?: string | null;
  source?: string | null;
  imported_at?: string;
  imported_by_user_id?: string | null;
};

export type OpportunityDiscoveryJob = {
  source: string | null;
  niche: string | null;
  location: string | null;
  created_at: string | null;
  completed_at?: string | null;
  status?: string | null;
  leads_found?: number | null;
  leads_new?: number | null;
  estimated_cost_usd?: number | null;
};

export type OpportunityLead = {
  id: string;
  niche: string | null;
  address: string | null;
  prospect_score?: number | null;
  created_at?: string | null;
};

export type LocationOpportunityFilters = {
  departamento?: string | null;
  ciudad?: string | null;
  barrio?: string | null;
  niche?: string | null;
  limit?: number;
  min_score?: number;
};

export type LocationOpportunityMetrics = {
  jobs_count: number;
  candidates_seen: number;
  new_leads_count: number;
  duplicate_count: number;
  success_rate: number;
  duplicate_rate: number;
  avg_cost_per_new_lead: number | null;
  last_discovery_at: string | null;
  coverage_lead_count: number;
  historical_scope: "direct" | "parent" | "ancestor" | "none";
  inherited_from: string[];
};

export type LocationOpportunitySuggestion = {
  catalog_entry: OpportunityCatalogEntry;
  niche: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  expected_new_leads: number;
  duplicate_risk: number;
  cost_estimate: number | null;
  reasons: string[];
  historical_metrics: LocationOpportunityMetrics;
};

type CatalogHierarchy = {
  departamento: string | null;
  ciudad: string | null;
  barrio: string | null;
  pathKeys: string[];
  pathLabels: string[];
};

type Aggregate = {
  jobs_count: number;
  candidates_seen: number;
  new_leads_count: number;
  duplicate_count: number;
  total_cost_usd: number;
  last_discovery_at: string | null;
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return buildLocationKey(trimmed) || null;
}

function normalizeNiche(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function buildHierarchyLookup(entries: OpportunityCatalogEntry[]): Map<string, CatalogHierarchy> {
  const byKey = new Map(entries.map((entry) => [entry.location_key, entry]));
  const byName = new Map<string, OpportunityCatalogEntry>();
  for (const entry of entries) {
    const nameKey = buildLocationKey(entry.display_name);
    if (!byName.has(nameKey)) byName.set(nameKey, entry);
  }

  const hierarchy = new Map<string, CatalogHierarchy>();

  function resolve(entry: OpportunityCatalogEntry, visiting = new Set<string>()): CatalogHierarchy {
    const cached = hierarchy.get(entry.location_key);
    if (cached) return cached;
    if (visiting.has(entry.location_key)) {
      return {
        departamento: null,
        ciudad: entry.kind === "ciudad" ? entry.display_name : null,
        barrio: entry.kind === "barrio" || entry.kind === "zona_turistica" || entry.kind === "polo_industrial" || entry.kind === "avenida" ? entry.display_name : null,
        pathKeys: [entry.location_key],
        pathLabels: [entry.display_name],
      };
    }

    visiting.add(entry.location_key);
    const parentKey = normalizeOptional(entry.parent_location);
    const parent = parentKey ? byKey.get(parentKey) ?? byName.get(parentKey) ?? null : null;
    const parentHierarchy = parent ? resolve(parent, visiting) : null;

    let departamento = parentHierarchy?.departamento ?? null;
    let ciudad = parentHierarchy?.ciudad ?? null;
    let barrio = parentHierarchy?.barrio ?? null;

    if (entry.kind === "departamento") {
      departamento = entry.display_name;
    } else if (entry.kind === "ciudad") {
      ciudad = entry.display_name;
      departamento = departamento ?? entry.parent_location ?? null;
    } else {
      barrio = entry.display_name;
      ciudad = ciudad ?? entry.parent_location ?? null;
    }

    const resolved: CatalogHierarchy = {
      departamento,
      ciudad,
      barrio,
      pathKeys: [entry.location_key, ...(parentHierarchy?.pathKeys ?? [])],
      pathLabels: [entry.display_name, ...(parentHierarchy?.pathLabels ?? [])],
    };
    hierarchy.set(entry.location_key, resolved);
    visiting.delete(entry.location_key);
    return resolved;
  }

  for (const entry of entries) {
    resolve(entry);
  }

  return hierarchy;
}

function buildJobAggregate(jobs: OpportunityDiscoveryJob[], nicheFilter: string | null): Map<string, Aggregate> {
  const aggregates = new Map<string, Aggregate>();

  for (const job of jobs) {
    const locationKey = normalizeOptional(job.location);
    if (!locationKey) continue;
    const jobNiche = normalizeNiche(job.niche);
    if (nicheFilter && jobNiche && jobNiche !== nicheFilter) continue;
    if (nicheFilter && !jobNiche) continue;

    const entry = aggregates.get(locationKey) ?? {
      jobs_count: 0,
      candidates_seen: 0,
      new_leads_count: 0,
      duplicate_count: 0,
      total_cost_usd: 0,
      last_discovery_at: null,
    };

    const candidatesSeen = Math.max(0, asNumber(job.leads_found));
    const newLeads = Math.max(0, asNumber(job.leads_new));
    const duplicates = Math.max(0, candidatesSeen - newLeads);
    const completedAt = typeof job.completed_at === "string" && job.completed_at ? job.completed_at : null;
    const createdAt = typeof job.created_at === "string" && job.created_at ? job.created_at : null;
    const lastAt = completedAt ?? createdAt;

    entry.jobs_count += 1;
    entry.candidates_seen += candidatesSeen;
    entry.new_leads_count += newLeads;
    entry.duplicate_count += duplicates;
    entry.total_cost_usd += Math.max(0, asNumber(job.estimated_cost_usd));
    if (lastAt && (!entry.last_discovery_at || lastAt > entry.last_discovery_at)) {
      entry.last_discovery_at = lastAt;
    }

    aggregates.set(locationKey, entry);
  }

  return aggregates;
}

function buildCoverageAggregate(leads: OpportunityLead[], nicheFilter: string | null): Map<string, number> {
  const coverage = new Map<string, number>();
  for (const lead of leads) {
    const leadNiche = normalizeNiche(lead.niche);
    if (nicheFilter && leadNiche && leadNiche !== nicheFilter) continue;
    if (nicheFilter && !leadNiche) continue;

    const key = normalizeOptional(deriveLocationLabelFromAddress(lead.address));
    if (!key) continue;
    coverage.set(key, (coverage.get(key) ?? 0) + 1);
  }
  return coverage;
}

function resolveHistoricalMetrics(
  entry: OpportunityCatalogEntry,
  hierarchy: CatalogHierarchy,
  jobAggregates: Map<string, Aggregate>,
  coverageAggregates: Map<string, number>
): LocationOpportunityMetrics {
  const scopeKeys = hierarchy.pathKeys;
  const scopeLabels = hierarchy.pathLabels;

  for (let index = 0; index < scopeKeys.length; index += 1) {
    const aggregate = jobAggregates.get(scopeKeys[index]!);
    const coverageLeadCount = coverageAggregates.get(scopeKeys[index]!) ?? 0;
    if (!aggregate) {
      if (coverageLeadCount > 0 && index === scopeKeys.length - 1) {
        return {
          jobs_count: 0,
          candidates_seen: 0,
          new_leads_count: 0,
          duplicate_count: 0,
          success_rate: 0,
          duplicate_rate: 0,
          avg_cost_per_new_lead: null,
          last_discovery_at: null,
          coverage_lead_count: coverageLeadCount,
          historical_scope: "none",
          inherited_from: [],
        };
      }
      continue;
    }

    const successRate = aggregate.candidates_seen > 0 ? aggregate.new_leads_count / aggregate.candidates_seen : 0;
    const duplicateRate = aggregate.candidates_seen > 0 ? aggregate.duplicate_count / aggregate.candidates_seen : 0;
    const avgCostPerNewLead = aggregate.new_leads_count > 0 ? aggregate.total_cost_usd / aggregate.new_leads_count : null;

    return {
      jobs_count: aggregate.jobs_count,
      candidates_seen: aggregate.candidates_seen,
      new_leads_count: aggregate.new_leads_count,
      duplicate_count: aggregate.duplicate_count,
      success_rate: round(successRate, 4),
      duplicate_rate: round(duplicateRate, 4),
      avg_cost_per_new_lead: avgCostPerNewLead == null ? null : round(avgCostPerNewLead, 2),
      last_discovery_at: aggregate.last_discovery_at,
      coverage_lead_count: coverageLeadCount,
      historical_scope: index === 0 ? "direct" : index === 1 ? "parent" : "ancestor",
      inherited_from: index === 0 ? [] : [scopeLabels[index] ?? entry.display_name],
    };
  }

  return {
    jobs_count: 0,
    candidates_seen: 0,
    new_leads_count: 0,
    duplicate_count: 0,
    success_rate: 0,
    duplicate_rate: 0,
    avg_cost_per_new_lead: null,
    last_discovery_at: null,
    coverage_lead_count: 0,
    historical_scope: "none",
    inherited_from: [],
  };
}

function buildConfidence(metrics: LocationOpportunityMetrics): "high" | "medium" | "low" {
  if (metrics.historical_scope === "direct" && metrics.jobs_count >= 3 && metrics.candidates_seen >= 30) return "high";
  if (metrics.jobs_count >= 2 && metrics.candidates_seen >= 15) return "medium";
  return "low";
}

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function buildScore(
  entry: OpportunityCatalogEntry,
  metrics: LocationOpportunityMetrics
): { score: number; expected_new_leads: number; cost_estimate: number | null; reasons: string[] } {
  let score = 18;
  const reasons: string[] = [];
  const catalogStrength = clamp(asNumber(entry.commercial_score), 0, 100) / 100;
  score += catalogStrength * 18;

  if (metrics.jobs_count === 0) {
    score += 10 + catalogStrength * 8;
    reasons.push("Sin histórico suficiente en la zona; queda como exploración controlada apoyada por el catálogo.");
  } else {
    score += metrics.success_rate * 48;
    score -= metrics.duplicate_rate * 30;
    score -= Math.min(metrics.coverage_lead_count * 4, 20);

    if (metrics.success_rate >= 0.35) {
      reasons.push(`Éxito histórico sólido: ${Math.round(metrics.success_rate * 100)}% de leads nuevos sobre candidatos vistos.`);
    } else if (metrics.success_rate > 0) {
      reasons.push(`Éxito histórico moderado: ${Math.round(metrics.success_rate * 100)}% de leads nuevos.`);
    }

    if (metrics.duplicate_rate >= 0.5) {
      reasons.push(`Duplicación alta: ${Math.round(metrics.duplicate_rate * 100)}% ya existía.`);
    } else if (metrics.duplicate_rate > 0) {
      reasons.push(`Duplicación controlada: ${Math.round(metrics.duplicate_rate * 100)}%.`);
    }

    if (metrics.avg_cost_per_new_lead != null) {
      if (metrics.avg_cost_per_new_lead <= 0.3) {
        score += 8;
        reasons.push(`Costo eficiente por lead nuevo: USD ${metrics.avg_cost_per_new_lead.toFixed(2)}.`);
      } else if (metrics.avg_cost_per_new_lead >= 1.2) {
        score -= 8;
        reasons.push(`Costo alto por lead nuevo: USD ${metrics.avg_cost_per_new_lead.toFixed(2)}.`);
      }
    }
  }

  const days = daysSince(metrics.last_discovery_at);
  if (days != null) {
    if (days < 14) {
      score -= 18;
      reasons.push(`Discovery muy reciente (${days} días); se baja prioridad para evitar saturación.`);
    } else if (days < 30) {
      score -= 10;
      reasons.push(`Discovery reciente (${days} días); se aplica penalización moderada.`);
    } else if (days > 90 && metrics.jobs_count > 0) {
      score += 4;
      reasons.push(`La última exploración fue hace ${days} días; vale reabrir la zona.`);
    }
  }

  if (metrics.coverage_lead_count <= 2) {
    score += 6;
    reasons.push(`Cobertura actual baja (${metrics.coverage_lead_count} leads registrados).`);
  } else if (metrics.coverage_lead_count >= 6) {
    score -= 8;
    reasons.push(`Cobertura actual alta (${metrics.coverage_lead_count} leads registrados).`);
  }

  if (metrics.historical_scope !== "direct" && metrics.inherited_from.length > 0) {
    score -= 6;
    reasons.push(`La señal histórica se heredó desde ${metrics.inherited_from.join(", ")}; confianza más baja.`);
  }

  const boundedScore = round(clamp(score, 0, 100));
  const avgCandidatesPerJob = metrics.jobs_count > 0 ? metrics.candidates_seen / metrics.jobs_count : 18;
  const expectedNewLeads = round(Math.max(metrics.jobs_count > 0 ? avgCandidatesPerJob * metrics.success_rate : 1 + catalogStrength * 2, 0), 1);
  const costEstimate = metrics.avg_cost_per_new_lead != null ? round(metrics.avg_cost_per_new_lead * expectedNewLeads, 2) : null;

  if (reasons.length === 0) {
    reasons.push("Sin señales suficientes para elevar o penalizar la prioridad más allá del score base.");
  }

  return { score: boundedScore, expected_new_leads: expectedNewLeads, cost_estimate: costEstimate, reasons };
}

function matchesHierarchyFilters(hierarchy: CatalogHierarchy, filters: LocationOpportunityFilters): boolean {
  const departamento = normalizeOptional(filters.departamento);
  const ciudad = normalizeOptional(filters.ciudad);
  const barrio = normalizeOptional(filters.barrio);

  if (departamento && normalizeOptional(hierarchy.departamento) !== departamento) return false;
  if (ciudad && normalizeOptional(hierarchy.ciudad) !== ciudad) return false;
  if (barrio && normalizeOptional(hierarchy.barrio) !== barrio) return false;
  return true;
}

export function buildLocationOpportunitySuggestions(params: {
  catalog: OpportunityCatalogEntry[];
  discoveryJobs: OpportunityDiscoveryJob[];
  leads: OpportunityLead[];
  filters?: LocationOpportunityFilters;
}): LocationOpportunitySuggestion[] {
  const filters = params.filters ?? {};
  const nicheFilter = normalizeNiche(filters.niche);
  const hierarchyLookup = buildHierarchyLookup(params.catalog);
  const jobAggregates = buildJobAggregate(params.discoveryJobs, nicheFilter);
  const coverageAggregates = buildCoverageAggregate(params.leads, nicheFilter);
  const minScore = typeof filters.min_score === "number" ? filters.min_score : 0;
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);

  return params.catalog
    .filter((entry) => matchesHierarchyFilters(hierarchyLookup.get(entry.location_key) ?? {
      departamento: null,
      ciudad: null,
      barrio: null,
      pathKeys: [entry.location_key],
      pathLabels: [entry.display_name],
    }, filters))
    .map((entry) => {
      const hierarchy = hierarchyLookup.get(entry.location_key) ?? {
        departamento: null,
        ciudad: null,
        barrio: null,
        pathKeys: [entry.location_key],
        pathLabels: [entry.display_name],
      };
      const metrics = resolveHistoricalMetrics(entry, hierarchy, jobAggregates, coverageAggregates);
      const confidence = buildConfidence(metrics);
      const scoreData = buildScore(entry, metrics);
      return {
        catalog_entry: entry,
        niche: nicheFilter,
        score: scoreData.score,
        confidence,
        expected_new_leads: scoreData.expected_new_leads,
        duplicate_risk: round(metrics.duplicate_rate, 4),
        cost_estimate: scoreData.cost_estimate,
        reasons: scoreData.reasons,
        historical_metrics: metrics,
      } satisfies LocationOpportunitySuggestion;
    })
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const confidenceOrder = { high: 2, medium: 1, low: 0 };
      if (confidenceOrder[right.confidence] !== confidenceOrder[left.confidence]) {
        return confidenceOrder[right.confidence] - confidenceOrder[left.confidence];
      }
      const rightCommercial = asNumber(right.catalog_entry.commercial_score);
      const leftCommercial = asNumber(left.catalog_entry.commercial_score);
      if (rightCommercial !== leftCommercial) return rightCommercial - leftCommercial;
      return left.catalog_entry.display_name.localeCompare(right.catalog_entry.display_name);
    })
    .slice(0, limit);
}
