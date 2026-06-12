import { fetchAllRows } from "../services/fetch-all-rows.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser } from "../auth/middleware.js";
import {
  buildGridCell,
  buildDiscoveryRecommendations,
  buildLeadDensityRows,
  buildLeadDensitySnapshot,
  buildLeadLocationKey,
  estimateGooglePlacesBatchCost,
  getPrimaryCoordinate,
  matchesLeadDensityFilters,
  parseGranularLocationKey,
  supportedDiscoverySources,
  type LeadInsightRow,
  type DiscoveryJobInsightRow,
  type GooglePlacesBudgetRow,
  type CompletedRunInsightRow,
} from "./discovery-insights.js";
import { bulkInsertDiscoveryJobs } from "../../../src/storage/discovery-jobs.js";
import { listDiscoveryPlaces, type DiscoveryPlaceKind } from "../../../src/storage/discovery-places.js";
import { getGooglePlacesBudgetStatus } from "../../../src/storage/pipeline-config.js";
import {
  buildLocationOpportunitySuggestions,
  type OpportunityDiscoveryJob,
  type OpportunityLead,
} from "../../../src/modules/discovery/location-opportunity.js";
import { createLeadGeocodingService } from "../services/lead-geocoding.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const cpuBudgetSchema = z.enum(["conservative", "balanced", "aggressive"]);
const profileSchema = z.enum(["A", "B", "C", "D"]);
const sourceSchema = z.enum(["mintur", "osm", "yelu", "pedidosya", "google_places", "miem_dei"]);

const predictiveContextSchema = z.object({
  suggestion_source: z.literal("predictive_location"),
  location_catalog_entry_id: z.string().min(1),
  opportunity_score_snapshot: z.unknown().optional(),
});

const createJobSchema = z
  .object({
    source: sourceSchema,
    location: z.string().min(1),
    niche: z.string().optional(),
    profile: profileSchema.optional(),
    max_results: z.number().int().min(1).max(1000).default(200),
    concurrency: z.number().int().min(1).max(10).optional(),
    cpu_budget: cpuBudgetSchema.default("balanced"),
    cost_cap_usd: z.number().positive().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === "google_places" && value.cost_cap_usd == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cost_cap_usd"],
        message: "Google Places legacy jobs require cost_cap_usd",
      });
    }
  });

const createBatchSchema = z
  .object({
    sources: z.array(sourceSchema).min(1),
    location: z.string().min(1),
    niche: z.string().optional(),
    max_results: z.number().int().min(1).max(1000).default(200),
    cpu_budget: cpuBudgetSchema.default("balanced"),
    google_places: z
      .object({
        profile: profileSchema.optional(),
        concurrency: z.number().int().min(1).max(10).optional(),
        cost_cap_usd: z.number().positive().max(500),
      })
      .optional(),
    recommendation_origin: z
      .object({
        type: z.enum(["coverage_gap", "location_density", "top_niche", "manual", "predictive_location"]),
        key: z.string().optional(),
      })
      .optional(),
    enrich_after_discovery: z.boolean().default(true),
    predictive_context: predictiveContextSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const includesGoogle = value.sources.includes("google_places");
    if (includesGoogle && !value.google_places?.cost_cap_usd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["google_places", "cost_cap_usd"],
        message: "Google Places batches require cost_cap_usd",
      });
    }
  });

const patchJobSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

const listJobsQuerySchema = z.object({
  status: z.string().optional(),
  cursor: permissiveUuid.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

const listBatchesQuerySchema = listJobsQuerySchema.extend({
  include_jobs: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const recommendationsQuerySchema = z.object({
  sources: z.union([z.string(), z.array(z.string())]).optional(),
  location: z.string().optional(),
  niche: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "20"), 100))
    .pipe(z.number().int().min(1).max(100)),
});

const LEAD_DENSITY_CONTACT_TIERS = ["A", "B", "C", "D", "X"] as const;
const LEAD_DENSITY_GPS_SOURCES = ["real", "inferred", "google"] as const;
const LEAD_DENSITY_HEAT_METRICS = ["mixed", "marketing", "software", "combined"] as const;
const GEO_ZONE_KIND_OPTIONS = ["departamento", "ciudad", "barrio", "zona_turistica", "polo_industrial", "avenida"] as const;

// Acota una coordenada del query a [min, max]. Vacío/no-numérico → undefined (sin bbox).
// Evita el 400 cuando el mapa, en zoom-out extremo, manda bounds que dan la vuelta al mundo.
function clampGeo(value: string | undefined, min: number, max: number): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

const geoFilterQueryFields = {
  source: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => parseMultiValue(value))
    .refine(
      (value) => !value || value.every((entry) => supportedDiscoverySources().includes(entry)),
      { message: "source must use supported discovery sources" }
    ),
  contact_tier: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => parseMultiValue(value)?.map((entry) => entry.toUpperCase()))
    .refine(
      (value) => !value || value.every((entry) => LEAD_DENSITY_CONTACT_TIERS.includes(entry as (typeof LEAD_DENSITY_CONTACT_TIERS)[number])),
      { message: "contact_tier must be one of A, B, C, D or X" }
    ),
  primary_offer: z.string().trim().min(1).optional(),
  commercial_offer_type: z.enum(["marketing", "software", "both", "unknown"]).optional(),
  gps_source: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => parseMultiValue(value))
    .refine(
      (value) => !value || value.every((entry) => LEAD_DENSITY_GPS_SOURCES.includes(entry as (typeof LEAD_DENSITY_GPS_SOURCES)[number])),
      { message: "gps_source must be one of real, inferred or google" }
    ),
  prospect_score_gte: z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value.trim() === "") return undefined;
      return Number(value);
    })
    .pipe(z.number().min(0).max(100).optional()),
  zone_id: z.string().trim().min(1).max(120).optional(),
  zone_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => parseMultiValue(value)),
  zone: z.string().trim().min(1).max(120).optional(),
  zoom: z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value.trim() === "") return undefined;
      return Number(value);
    })
    .pipe(z.number().min(0).max(22).optional()),
  // Un viewport de mapa con zoom-out extremo manda bounds fuera de rango (da la vuelta al
  // mundo: west < -180, east > 180). No es un error del cliente: se ACOTAN al rango válido
  // en vez de rechazar con 400. NaN / vacío → undefined (sin bbox).
  south: z.string().optional().transform((value) => clampGeo(value, -90, 90)),
  west: z.string().optional().transform((value) => clampGeo(value, -180, 180)),
  north: z.string().optional().transform((value) => clampGeo(value, -90, 90)),
  east: z.string().optional().transform((value) => clampGeo(value, -180, 180)),
  heat_metric: z.enum(LEAD_DENSITY_HEAT_METRICS).optional(),
} satisfies z.ZodRawShape;

const leadDensityQuerySchema = recommendationsQuerySchema.extend(geoFilterQueryFields).extend({
  // Geocoding por request es costoso (bloquea la carga del mapa). Default off:
  // el mapa carga rápido solo con GPS y reporta los leads sin coordenadas (deferred).
  include_geocode: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const batchActionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

const locationSuggestionsQuerySchema = z.object({
  departamento: z.string().trim().min(1).max(120).optional(),
  ciudad: z.string().trim().min(1).max(120).optional(),
  barrio: z.string().trim().min(1).max(120).optional(),
  niche: z.string().trim().min(1).max(80).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "20"), 100))
    .pipe(z.number().int().min(1).max(100)),
  min_score: z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value.trim() === "") return undefined;
      return Number(value);
    })
    .pipe(z.number().min(0).max(100).optional()),
});

const geoZonesQuerySchema = z.object({
  kind: z.enum(GEO_ZONE_KIND_OPTIONS).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "100"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

const zoneLeadsQuerySchema = z
  .object({
    location_key: z.string().min(1).max(120).optional(),
    parent_location_key: z.string().min(1).max(120).optional(),
    grid_location_key: z.string().min(1).max(120).optional(),
    limit: z.string().optional()
      .transform((v) => Math.min(Number(v ?? "200"), 200))
      .pipe(z.number().int().min(1).max(200)),
  })
  .extend(geoFilterQueryFields)
  .superRefine((value, ctx) => {
    if (!value.location_key && !value.parent_location_key && !value.grid_location_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["location_key"],
        message: "location_key or parent/grid location keys are required",
      });
    }
  });

const VALID_JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled", "paused"];
const leadGeocodingService = createLeadGeocodingService();

const JOB_STATUS_TRANSITIONS: Record<string, string> = {
  pause: "paused",
  resume: "queued",
  cancel: "cancelled",
};

function buildLocationKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/\b(uruguay|uy|departamento|depto|ciudad)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isValidMapPoint(point: { lat: number; lng: number } | null | undefined): point is { lat: number; lng: number } {
  return Boolean(
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    point.lat !== 0 &&
    point.lng !== 0
  );
}

function gridCellForRequestedKey(point: { lat: number; lng: number }, gridLocationKey: string) {
  const aggregationLevel = gridLocationKey.split(":", 1)[0];
  if (aggregationLevel === "country") return buildGridCell(point, 0.45, "country");
  if (aggregationLevel === "regional") return buildGridCell(point, 0.12, "regional");
  if (aggregationLevel === "local") return buildGridCell(point, 0.04, "local");
  return buildGridCell(point);
}

async function resolveZoneLocationMatch(
  lead: LeadInsightRow,
  requestedParentLocationKey: string,
  requestedGridLocationKey: string | null
): Promise<{ lat: number; lng: number } | null> {
  const parentLocationKey = buildLeadLocationKey(lead.address);
  if (parentLocationKey !== requestedParentLocationKey) return null;

  const rawCoordinate = getPrimaryCoordinate(lead);
  let geocodedCoordinate: { lat: number; lng: number } | null = null;
  if (!rawCoordinate && typeof lead.address === "string" && lead.address.trim() !== "") {
    try {
      const point = await leadGeocodingService.geocodeAddress(lead.address);
      geocodedCoordinate = isValidMapPoint(point) ? point : null;
    } catch {
      geocodedCoordinate = null;
    }
  }
  const coordinate = rawCoordinate ?? (geocodedCoordinate ? { ...geocodedCoordinate, source: "geocoded" as const } : null);
  if (!coordinate) return null;
  if (!requestedGridLocationKey) return { lat: coordinate.lat, lng: coordinate.lng };

  return gridCellForRequestedKey(coordinate, requestedGridLocationKey).gridKey === requestedGridLocationKey ? { lat: coordinate.lat, lng: coordinate.lng } : null;
}
function isDiscoveryBatchSchemaMissing(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  if (!error) return false;
  const combined = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return ["42p01", "42703", "pgrst204"].some((code) => combined.includes(code))
    || (combined.includes("discovery_job_batches") && (combined.includes("does not exist") || combined.includes("could not find") || combined.includes("schema cache")))
    || (combined.includes("batch_id") && (combined.includes("does not exist") || combined.includes("could not find") || combined.includes("schema cache")));
}

function isMissingLeadContactTierSchema(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  if (!error) return false;
  const combined = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return combined.includes("42703") && combined.includes("contact_tier");
}

async function fetchGpsByLeadIds(db: ReturnType<typeof getDb>, leadIds: string[], request: { log: FastifyInstance["log"] }) {
  const gpsById = new Map<string, unknown>();
  if (leadIds.length === 0) return gpsById;

  const chunkSize = 100;
  for (let index = 0; index < leadIds.length; index += chunkSize) {
    const chunk = leadIds.slice(index, index + chunkSize);
    const gpsQuery = await db.from("leads").select("id, gps").in("id", chunk);
    if (gpsQuery.error) {
      request.log.warn({ error: gpsQuery.error, chunk_size: chunk.length }, "map routes could not enrich gps from leads table");
      continue;
    }
    for (const row of gpsQuery.data ?? []) {
      const record = row as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : String(record.id ?? "");
      if (id) gpsById.set(id, record.gps ?? null);
    }
  }

  return gpsById;
}

async function loadLeadDensityRows(request: { log: FastifyInstance["log"] }) {
  const db = getDb();
  // N55: paginado con range() — ver loadZoneLeadRows.
  let baseQuery: { data: unknown[] | null; error: { message: string } | null };
  try {
    const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
      db
        .from("lead_dashboard")
        .select("id, source, niche, address, prospect_score, contact_tier, primary_offer, corroborating_sources, created_at")
        .order("created_at", { ascending: false })
        .range(from, to)
    );
    baseQuery = { data: rows, error: null };
  } catch (err) {
    baseQuery = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }

  if (baseQuery.error) {
    request.log.warn({ error: baseQuery.error }, "lead density fallback to legacy leads table");
    const legacyQuery = await db
      .from("leads")
      .select("id, source, niche, address, prospect_score, gps, corroborating_sources")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (legacyQuery.error) {
      request.log.error({ error: legacyQuery.error }, "lead density load error");
      throw new Error("db_error");
    }

    return {
      data: (legacyQuery.data ?? []).map((lead) => ({ ...(lead as Record<string, unknown>), contact_tier: null, primary_offer: null, commercial_offers_summary: null })) as unknown as LeadInsightRow[],
      schemaFallback: true,
    };
  }

  const leadIds = (baseQuery.data ?? [])
    .map((lead) => String((lead as Record<string, unknown>).id ?? ""))
    .filter(Boolean);
  const gpsById = await fetchGpsByLeadIds(db, leadIds, request);
  return {
    data: (baseQuery.data ?? []).map((lead) => ({
      ...(lead as Record<string, unknown>),
      gps: gpsById.get(String((lead as Record<string, unknown>).id)) ?? null,
      commercial_offers_summary: null,
    })) as unknown as LeadInsightRow[],
    schemaFallback: false,
  };
}

type GeoZoneLeadRow = LeadInsightRow & {
  name?: string | null;
  created_at?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  rating?: number | null;
  review_count?: number | null;
  primary_offer?: string | null;
  pitch_hook?: string | null;
  contact_ready?: boolean | null;
  tags?: string[] | null;
};

type AdminGeoZoneOption = {
  zone_id: string;
  departamento: string | null;
  ciudad: string | null;
  barrio: string | null;
  label: string;
  kind: DiscoveryPlaceKind;
  lead_count: number;
  last_seen_at: string | null;
};

async function loadZoneLeadRows(request: { log: FastifyInstance["log"] }) {
  const db = getDb();
  // N55: paginado con range() — limit(5000) devolvía 1000 filas (max_rows de PostgREST).
  let baseQuery: { data: unknown[] | null; error: { message: string } | null };
  try {
    const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
      db
        .from("lead_dashboard")
        .select("id, name, niche, contact_tier, prospect_score, address, source, corroborating_sources, created_at, website, phone, whatsapp, rating, review_count, primary_offer, pitch_hook, contact_ready, tags, score_breakdown, digital_footprint")
        .order("created_at", { ascending: false })
        .range(from, to)
    );
    baseQuery = { data: rows, error: null };
  } catch (err) {
    baseQuery = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }

  if (baseQuery.error) {
    request.log.warn({ error: baseQuery.error }, "zone-leads fallback to legacy leads table");
    const legacyQuery = await db
      .from("leads")
      .select("id, name, niche, address, gps, source, corroborating_sources, created_at, website, phone, whatsapp, rating, review_count, tags, score_breakdown, digital_footprint")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (legacyQuery.error) {
      request.log.error({ error: legacyQuery.error }, "zone-leads load error");
      throw new Error("db_error");
    }

    return (legacyQuery.data ?? []).map((lead) => ({
      ...(lead as Record<string, unknown>),
      prospect_score: null,
      contact_tier: null,
      email: null,
      website: null,
      phone: null,
      whatsapp: null,
      rating: null,
      review_count: null,
      primary_offer: null,
      pitch_hook: null,
      contact_ready: null,
      tags: null,
    })) as unknown as LeadInsightRow[];
  }

  const leadIds = (baseQuery.data ?? [])
    .map((lead) => String((lead as Record<string, unknown>).id ?? ""))
    .filter(Boolean);
  const gpsById = await fetchGpsByLeadIds(db, leadIds, request);
  return (baseQuery.data ?? []).map((lead) => ({
    ...(lead as Record<string, unknown>),
    gps: gpsById.get(String((lead as Record<string, unknown>).id)) ?? null,
    email: null,
  })) as unknown as LeadInsightRow[];
}


async function recomputeBatchAggregate(db: ReturnType<typeof getDb>, batchId: string): Promise<void> {
  const { data, error } = await db
    .from("discovery_jobs")
    .select("status, started_at, completed_at, estimated_cost_usd, actual_cost_usd")
    .eq("batch_id", batchId);

  if (error) {
    throw new Error(`Failed to recompute batch ${batchId}: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const statuses = rows.map((row) => String(row["status"] ?? "queued"));
  const estimatedCostUsd = rows.reduce((sum, row) => sum + asNumber(row["estimated_cost_usd"]), 0);
  const actualCostUsd = rows.reduce((sum, row) => sum + asNumber(row["actual_cost_usd"]), 0);
  const startedAts = rows
    .map((row) => row["started_at"])
    .filter((value): value is string => typeof value === "string")
    .sort();
  const completedAts = rows
    .map((row) => row["completed_at"])
    .filter((value): value is string => typeof value === "string")
    .sort();

  let status = "queued";
  if (statuses.length === 0) {
    status = "queued";
  } else if (statuses.every((entry) => entry === "cancelled")) {
    status = "cancelled";
  } else if (statuses.every((entry) => entry === "completed")) {
    status = "completed";
  } else if (statuses.every((entry) => entry === "failed")) {
    status = "failed";
  } else if (statuses.some((entry) => entry === "running")) {
    status = "running";
  } else if (statuses.some((entry) => entry === "failed" || entry === "cancelled" || entry === "completed")) {
    status = "partial";
  }

  const isTerminal = statuses.length > 0 && statuses.every((entry) => ["completed", "failed", "cancelled"].includes(entry));
  const { error: updateError } = await db
    .from("discovery_job_batches")
    .update({
      status,
      started_at: startedAts[0] ?? null,
      completed_at: isTerminal ? completedAts[completedAts.length - 1] ?? new Date().toISOString() : null,
      estimated_cost_usd: Number(estimatedCostUsd.toFixed(2)),
      actual_cost_usd: Number(actualCostUsd.toFixed(2)),
    })
    .eq("id", batchId);

  if (updateError) {
    throw new Error(`Failed to update batch ${batchId}: ${updateError.message}`);
  }
}

function parseSources(raw: string | string[] | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const values = parts.map((part) => part.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseMultiValue(raw: string | string[] | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const values = parts.map((part) => part.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

type GeoFilterQueryData = z.infer<typeof leadDensityQuerySchema>;

function normalizeZoneId(value: string): string {
  return buildLocationKey(value);
}

function resolveZoneIds(query: Pick<GeoFilterQueryData, "zone_id" | "zone_ids" | "zone">): string[] | undefined {
  const values = [
    ...(query.zone_ids ?? []),
    ...(query.zone_id ? [query.zone_id] : []),
    ...(query.zone ? [query.zone] : []),
  ]
    .map((value) => normalizeZoneId(value))
    .filter(Boolean);

  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function buildLeadDensityFiltersFromQuery(query: GeoFilterQueryData) {
  const hasBounds = [query.south, query.west, query.north, query.east].every((value) => typeof value === "number" && Number.isFinite(value));
  return {
    filters: {
      sources: query.source,
      niche: query.niche ?? null,
      prospect_score_gte: query.prospect_score_gte ?? null,
      contact_tiers: query.contact_tier,
      primary_offer: query.primary_offer ?? null,
      commercial_offer_type: query.commercial_offer_type ?? null,
      gps_sources: query.gps_source as Array<"real" | "inferred" | "google"> | undefined,
      ...(hasBounds ? { bbox: { south: query.south!, west: query.west!, north: query.north!, east: query.east! } } : {}),
      ...(typeof query.zoom === "number" ? { zoom: query.zoom } : {}),
      ...(query.heat_metric ? { heat_metric: query.heat_metric } : {}),
    },
    zoneIds: resolveZoneIds(query),
  };
}

function matchesZoneIdsFilter(lead: LeadInsightRow, zoneIds: string[] | undefined): boolean {
  if (!zoneIds || zoneIds.length === 0) return true;
  const parentLocationKey = buildLeadLocationKey((lead.address ?? "").trim());
  return parentLocationKey !== "" && zoneIds.includes(parentLocationKey);
}

function buildDerivedGeoZones(leads: GeoZoneLeadRow[], query: z.infer<typeof geoZonesQuerySchema>): AdminGeoZoneOption[] {
  if (query.kind && query.kind !== "ciudad") return [];

  const normalizedQuery = buildLocationKey(query.q ?? "");
  const densityRows = buildLeadDensityRows(leads);
  const lastSeenByZone = new Map<string, string | null>();
  for (const lead of leads) {
    const key = buildLeadLocationKey((lead.address ?? "").trim());
    if (!key) continue;
    const createdAt = typeof lead.created_at === "string" ? lead.created_at : null;
    const current = lastSeenByZone.get(key) ?? null;
    if (!current || (createdAt && createdAt > current)) {
      lastSeenByZone.set(key, createdAt);
    }
  }

  return densityRows
    .filter((row) => !normalizedQuery || normalizeZoneId(row.location_label).includes(normalizedQuery) || row.location_key.includes(normalizedQuery))
    .slice(0, query.limit)
    .map((row) => ({
      zone_id: row.location_key,
      departamento: null,
      ciudad: row.location_label,
      barrio: null,
      label: row.location_label,
      kind: "ciudad",
      lead_count: row.lead_count,
      last_seen_at: lastSeenByZone.get(row.location_key) ?? null,
    }));
}

function buildCatalogGeoZone(place: Awaited<ReturnType<typeof listDiscoveryPlaces>>[number], leadStats: Map<string, { lead_count: number; last_seen_at: string | null }>): AdminGeoZoneOption {
  const stats = leadStats.get(place.location_key) ?? { lead_count: 0, last_seen_at: null };
  return {
    zone_id: place.location_key,
    departamento: place.kind === "departamento" ? place.display_name : null,
    ciudad: place.kind === "ciudad" ? place.display_name : place.parent_location,
    barrio: place.kind === "barrio" || place.kind === "zona_turistica" || place.kind === "polo_industrial" || place.kind === "avenida"
      ? place.display_name
      : null,
    label: place.display_name,
    kind: place.kind,
    lead_count: stats.lead_count,
    last_seen_at: stats.last_seen_at,
  };
}

async function listAdminGeoZones(request: { log: FastifyInstance["log"] }, query: z.infer<typeof geoZonesQuerySchema>): Promise<AdminGeoZoneOption[]> {
  let leads: GeoZoneLeadRow[] = [];
  try {
    leads = await loadZoneLeadRows(request);
  } catch {
    leads = [];
  }

  const leadStats = new Map<string, { lead_count: number; last_seen_at: string | null }>();
  for (const lead of leads) {
    const key = buildLeadLocationKey((lead.address ?? "").trim());
    if (!key) continue;
    const current = leadStats.get(key) ?? { lead_count: 0, last_seen_at: null };
    const createdAt = typeof lead.created_at === "string" ? lead.created_at : null;
    leadStats.set(key, {
      lead_count: current.lead_count + 1,
      last_seen_at: !current.last_seen_at || (createdAt && createdAt > current.last_seen_at) ? createdAt : current.last_seen_at,
    });
  }

  try {
    const places = await listDiscoveryPlaces({
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q ? { q: query.q } : {}),
      limit: query.limit,
    });
    if (places.length > 0) {
      return places.map((place) => buildCatalogGeoZone(place, leadStats));
    }
  } catch (error) {
    request.log.warn({ error }, "geo zones catalog unavailable, falling back to derived zones");
  }

  return buildDerivedGeoZones(leads, query);
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/discovery/jobs", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = listJobsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { status, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("discovery_jobs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (authUser.role === "cm") {
      query = query.eq("user_id", authUser.id);
    }

    if (status) {
      const filtered = status.split(",").map((s) => s.trim()).filter((s) => VALID_JOB_STATUSES.includes(s));
      if (filtered.length > 0) {
        query = query.in("status", filtered);
      }
    }

    if (cursor) {
      const { data: cursorRow } = await db
        .from("discovery_jobs")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      request.log.error({ error }, "discovery jobs list error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null : null;

    return reply.status(200).send({ data: page, next_cursor: nextCursor, total: count ?? 0 });
  });

  app.post("/discovery/jobs", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = createJobSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const authUser = getAuthUser(request);
    const body = parseResult.data;
    const db = getDb();
    const estimatedCostUsd = body.source === "google_places" ? estimateGooglePlacesBatchCost(body.max_results) : 0;

    const { data: job, error } = await db
      .from("discovery_jobs")
      .insert({
        source: body.source,
        location: body.location,
        niche: body.niche ?? null,
        profile: body.profile ?? null,
        max_results: body.max_results,
        concurrency: body.concurrency ?? null,
        cpu_budget: body.cpu_budget,
        status: "queued",
        triggered_by: "manual",
        user_id: authUser.id,
        estimated_cost_usd: body.source === "google_places" ? estimatedCostUsd : null,
        cost_cap_usd: body.source === "google_places" ? body.cost_cap_usd ?? null : null,
        source_params:
          body.source === "google_places"
            ? {
                profile: body.profile ?? "B",
                concurrency: body.concurrency ?? 5,
                cost_cap_usd: body.cost_cap_usd ?? null,
              }
            : null,
      })
      .select()
      .single();

    if (error) {
      request.log.error({ error }, "discovery job create error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(201).send({ data: job });
  });

  app.patch("/discovery/jobs/:id", {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!permissiveUuid.safeParse(id).success) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }
    const parseResult = patchJobSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const { data: job, error: fetchError } = await db
      .from("discovery_jobs")
      .select("id, status, batch_id")
      .eq("id", id)
      .single();

    if (fetchError || !job) {
      return reply.status(404).send({ error: "Job not found", error_code: "not_found" });
    }

    const { action } = parseResult.data;
    const newStatus = JOB_STATUS_TRANSITIONS[action];
    const { data: updated, error: updateError } = await db
      .from("discovery_jobs")
      .update({ status: newStatus })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    if ((updated as { batch_id?: string | null }).batch_id) {
      await recomputeBatchAggregate(db, (updated as { batch_id: string }).batch_id);
    }

    return reply.status(200).send({ data: updated });
  });

  app.post("/discovery/job-batches", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = createBatchSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const authUser = getAuthUser(request);
    const body = parseResult.data;
    const db = getDb();
    const uniqueSources = [...new Set(body.sources)];
    const estimatedCostUsd = uniqueSources.reduce((sum, source) => {
      if (source !== "google_places") return sum;
      return sum + estimateGooglePlacesBatchCost(body.max_results);
    }, 0);
    const costCapUsd = body.google_places?.cost_cap_usd ?? null;

    if (uniqueSources.includes("google_places") && estimatedCostUsd > 0) {
      const budget = await getGooglePlacesBudgetStatus();
      if (budget != null && estimatedCostUsd > budget.budget_remaining) {
        return reply.status(400).send({
          error: `Estimated cost USD ${estimatedCostUsd.toFixed(2)} exceeds remaining monthly GP budget USD ${budget.budget_remaining.toFixed(2)}`,
          error_code: "budget_exceeded",
          details: {
            estimated_cost_usd: estimatedCostUsd,
            budget_remaining: budget.budget_remaining,
            budget_total: budget.budget_total,
            budget_spent: budget.budget_spent,
          },
        });
      }
    }

    const { data: batch, error: batchError } = await db
      .from("discovery_job_batches")
      .insert({
        user_id: authUser.id,
        location: body.location,
        location_key: buildLocationKey(body.location),
        niche: body.niche ?? null,
        sources: uniqueSources,
        max_results: body.max_results,
        cpu_budget: body.cpu_budget,
        google_places: body.google_places ?? null,
        recommendation_origin: body.predictive_context
          ? {
              type: body.recommendation_origin?.type ?? "predictive_location",
              key: body.recommendation_origin?.key ?? buildLocationKey(body.location),
              ...body.predictive_context,
            }
          : body.recommendation_origin ?? { type: "manual" },
        enrich_after_discovery: body.enrich_after_discovery,
        estimated_cost_usd: Number(estimatedCostUsd.toFixed(2)),
        actual_cost_usd: 0,
        cost_cap_usd: costCapUsd,
        status: "queued",
      })
      .select()
      .single();

    if (batchError || !batch) {
      request.log.error({ error: batchError }, "discovery batch create error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const jobsPayload = uniqueSources.map((source) => ({
      batch_id: (batch as { id: string }).id,
      source,
      location: body.location,
      niche: body.niche ?? null,
      profile: source === "google_places" ? body.google_places?.profile ?? "B" : null,
      concurrency: source === "google_places" ? body.google_places?.concurrency ?? 5 : null,
      max_results: body.max_results,
      cpu_budget: body.cpu_budget,
      status: "queued",
      triggered_by:
        body.predictive_context
          ? "predictive_location"
          : body.recommendation_origin?.type === "manual" || !body.recommendation_origin
            ? "manual"
            : "gap_analysis",
      user_id: authUser.id,
      enrich_after_discovery: body.enrich_after_discovery,
      enrich_status: body.enrich_after_discovery ? "queued" : "skipped",
      estimated_cost_usd: source === "google_places" ? Number(estimateGooglePlacesBatchCost(body.max_results).toFixed(2)) : 0,
      actual_cost_usd: 0,
      cost_cap_usd: source === "google_places" ? body.google_places?.cost_cap_usd ?? null : null,
      source_params: {
        ...(source === "google_places"
          ? {
              profile: body.google_places?.profile ?? "B",
              concurrency: body.google_places?.concurrency ?? 5,
              cost_cap_usd: body.google_places?.cost_cap_usd ?? null,
            }
          : {}),
        ...(body.predictive_context ?? {}),
      },
    }));

    const { data: jobs, error: jobsError } = await db.from("discovery_jobs").insert(jobsPayload).select();
    if (jobsError) {
      request.log.error({ error: jobsError, batchId: (batch as { id: string }).id }, "discovery batch jobs create error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(201).send({ data: { ...batch, jobs: jobs ?? [] } });
  });

  app.get("/discovery/job-batches", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = listBatchesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { status, cursor, limit, include_jobs } = parseResult.data;
    const db = getDb();
    let query = db
      .from("discovery_job_batches")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (status) {
      const filtered = status.split(",").map((s) => s.trim()).filter((s) => VALID_JOB_STATUSES.includes(s));
      if (filtered.length > 0) {
        query = query.in("status", filtered);
      }
    }

    if (cursor) {
      const { data: cursorRow, error: cursorError } = await db
        .from("discovery_job_batches")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorError && !isDiscoveryBatchSchemaMissing(cursorError)) {
        request.log.error({ error: cursorError }, "discovery batches cursor lookup error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      if (isDiscoveryBatchSchemaMissing(error)) {
        request.log.warn({ error }, "discovery batches schema missing; returning empty workspace list");
        return reply.status(200).send({ data: [], next_cursor: null, total: 0 });
      }
      request.log.error({ error }, "discovery batches list error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null : null;

    if (!include_jobs || page.length === 0) {
      return reply.status(200).send({ data: page, next_cursor: nextCursor, total: count ?? 0 });
    }

    const batchIds = page.map((row) => (row as { id: string }).id);
    const { data: jobs, error: jobsError } = await db
      .from("discovery_jobs")
      .select("*")
      .in("batch_id", batchIds)
      .order("created_at", { ascending: true });

    if (jobsError) {
      if (isDiscoveryBatchSchemaMissing(jobsError)) {
        request.log.warn({ error: jobsError }, "discovery batch children schema missing; returning batches without jobs");
        return reply.status(200).send({
          data: page.map((row) => ({ ...row, jobs: [] })),
          next_cursor: nextCursor,
          total: count ?? 0,
        });
      }
      request.log.error({ error: jobsError }, "discovery batch children list error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const jobsByBatch = new Map<string, unknown[]>();
    for (const job of jobs ?? []) {
      const batchId = (job as { batch_id?: string | null }).batch_id;
      if (!batchId) continue;
      const current = jobsByBatch.get(batchId) ?? [];
      current.push(job);
      jobsByBatch.set(batchId, current);
    }

    return reply.status(200).send({
      data: page.map((row) => ({ ...row, jobs: jobsByBatch.get((row as { id: string }).id) ?? [] })),
      next_cursor: nextCursor,
      total: count ?? 0,
    });
  });

  app.patch("/discovery/job-batches/:id", {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!permissiveUuid.safeParse(id).success) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }
    const parseResult = batchActionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const { data: batch, error: batchError } = await db
      .from("discovery_job_batches")
      .select("id")
      .eq("id", id)
      .single();

    if (batchError || !batch) {
      return reply.status(404).send({ error: "Batch not found", error_code: "not_found" });
    }

    const { action } = parseResult.data;
    const nextStatus = JOB_STATUS_TRANSITIONS[action];
    const statusFilter = action === "resume" ? ["paused"] : ["queued", "running", "paused"];
    const { error: updateError } = await db
      .from("discovery_jobs")
      .update({ status: nextStatus })
      .eq("batch_id", id)
      .in("status", statusFilter);

    if (updateError) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    try {
      await recomputeBatchAggregate(db, id);
    } catch (aggErr) {
      request.log.error({ error: aggErr }, "discovery batch aggregate recompute failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const { data: updated } = await db
      .from("discovery_job_batches")
      .select("*")
      .eq("id", id)
      .single();

    return reply.status(200).send({ data: updated });
  });

  app.get("/discovery/recommendations", { preHandler: requireAdmin }, async (request, reply) => {
    const parsedQuery = recommendationsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parsedQuery.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const sources = parseSources(parsedQuery.data.sources);
    const [leadsRes, jobsRes, configRes, runsRes] = await Promise.all([
      db
        .from("leads")
        .select("id, source, niche, address, prospect_score, gps, corroborating_sources")
        .order("created_at", { ascending: false })
        .limit(5000),
      db
        .from("discovery_jobs")
        .select("source, niche, location, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("pipeline_config")
        .select("google_places_budget_total, google_places_budget_spent, google_places_alert_threshold")
        .limit(1)
        .single(),
      db
        .from("runs")
        .select("finished_at, stats")
        .eq("status", "completed")
        .order("finished_at", { ascending: false })
        .limit(500),
    ]);

    if (leadsRes.error || jobsRes.error || runsRes.error) {
      request.log.error({ leads: leadsRes.error, jobs: jobsRes.error, runs: runsRes.error }, "discovery recommendations load error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const data = buildDiscoveryRecommendations({
      leads: (leadsRes.data ?? []) as unknown as LeadInsightRow[],
      discoveryJobs: (jobsRes.data ?? []) as unknown as DiscoveryJobInsightRow[],
      budget: (configRes.data as unknown as GooglePlacesBudgetRow | null) ?? null,
      completedRuns: (runsRes.data ?? []) as unknown as CompletedRunInsightRow[],
      ...(sources ? { selectedSources: sources } : {}),
      ...(parsedQuery.data.location ? { location: parsedQuery.data.location } : {}),
      ...(parsedQuery.data.niche ? { niche: parsedQuery.data.niche } : {}),
      limit: parsedQuery.data.limit,
    });

    return reply.status(200).send({ data });
  });

  app.get("/discovery/location-suggestions", { preHandler: requireAdmin }, async (request, reply) => {
    const parsedQuery = locationSuggestionsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parsedQuery.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    // N55: paginado con range() — los limit(2000/5000) volvían capados a 1000.
    const [catalogResult, jobsRes, leadsRes] = await Promise.allSettled([
      listDiscoveryPlaces({ limit: 2000 }),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        db
          .from("discovery_jobs")
          .select("source, niche, location, created_at, completed_at, status, leads_found, leads_new, estimated_cost_usd, actual_cost_usd")
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        db
          .from("lead_dashboard")
          .select("id, niche, address, prospect_score, created_at")
          .order("created_at", { ascending: false })
          .range(from, to)
      ),
    ]);

    // fetchAllRows ya valida errores (rechaza la promesa) — fulfilled = filas completas.
    const jobsRows = jobsRes.status === "fulfilled" ? jobsRes.value : null;
    const leadsRows = leadsRes.status === "fulfilled" ? leadsRes.value : null;

    if (!jobsRows || !leadsRows) {
      request.log.error(
        { jobs: jobsRes.status === "rejected" ? String(jobsRes.reason) : null, leads: leadsRes.status === "rejected" ? String(leadsRes.reason) : null },
        "location suggestions history load error"
      );
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    let catalog;
    if (catalogResult.status === "fulfilled") {
      catalog = catalogResult.value;
    } else {
      request.log.warn({ error: catalogResult.reason }, "location suggestions catalog unavailable, deriving from current lead density");
      const fallbackLeads = await loadZoneLeadRows(request);
      catalog = buildDerivedGeoZones(fallbackLeads, { kind: undefined, q: undefined, limit: 2000 }).map((zone) => ({
        id: 'derived-' + zone.zone_id,
        location_key: zone.zone_id,
        display_name: zone.label,
        parent_location: zone.departamento,
        kind: zone.kind,
        commercial_score: null,
        lat_approx: null,
        lng_approx: null,
        notes: 'derived_from_leads',
        source: 'derived_from_leads',
        imported_at: new Date(0).toISOString(),
        imported_by_user_id: null,
      }));
    }

    const data = buildLocationOpportunitySuggestions({
      catalog,
      discoveryJobs: jobsRows as unknown as OpportunityDiscoveryJob[],
      leads: leadsRows as unknown as OpportunityLead[],
      filters: {
        departamento: parsedQuery.data.departamento ?? null,
        ciudad: parsedQuery.data.ciudad ?? null,
        barrio: parsedQuery.data.barrio ?? null,
        niche: parsedQuery.data.niche ?? null,
        limit: parsedQuery.data.limit,
        min_score: parsedQuery.data.min_score,
      },
    });

    return reply.status(200).send({ data, total: data.length });
  });

  app.get("/admin/geo/zones", { preHandler: requireAdmin }, async (request, reply) => {
    const parsedQuery = geoZonesQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parsedQuery.error.flatten().fieldErrors,
      });
    }

    const zones = await listAdminGeoZones(request, parsedQuery.data);
    return reply.status(200).send({ data: zones, total: zones.length });
  });

  app.get("/admin/geo/lead-density", { preHandler: requireAdmin }, async (request, reply) => {
    const parsedQuery = leadDensityQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: parsedQuery.error.flatten().fieldErrors,
      });
    }

    let leads: GeoZoneLeadRow[];
    try {
      leads = await loadZoneLeadRows(request) as GeoZoneLeadRow[];
    } catch {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const { filters: densityFilters, zoneIds } = buildLeadDensityFiltersFromQuery(parsedQuery.data);
    let density;
    try {
      const includeGeocode = parsedQuery.data.include_geocode === true;
      density = await buildLeadDensitySnapshot(
        zoneIds && zoneIds.length > 0 ? leads.filter((lead) => matchesZoneIdsFilter(lead, zoneIds)) : leads,
        {
          locationFilter: parsedQuery.data.location ?? null,
          filters: densityFilters,
          // Solo geocodificar en el request cuando se pide explícitamente (opt-in).
          // Por defecto el mapa carga rápido con GPS y deja el resto como deferred.
          ...(includeGeocode ? { geocodeAddress: leadGeocodingService.geocodeAddress } : {}),
          maxGeocodes: !includeGeocode
            ? 0
            : typeof parsedQuery.data.zoom === "number" && parsedQuery.data.zoom >= 14
              ? Math.min(240, Math.max(parsedQuery.data.limit * 10, 80))
              : Math.min(160, Math.max(parsedQuery.data.limit * 8, 40)),
        }
      );
    } catch (err) {
      request.log.error({ err }, "lead density snapshot build error");
      return reply.status(500).send({ error: "Error al procesar el mapa de densidad", error_code: "density_build_error" });
    }

    return reply.status(200).send({
      data: {
        ...density,
        locations: density.locations.slice(0, parsedQuery.data.limit),
      },
    });
  });

  app.get("/discovery/suggestions", { preHandler: requireAdmin }, async (request, reply) => {
    const query = new URLSearchParams(request.query as Record<string, string>).toString();
    const recommendations = await app.inject({
      method: "GET",
      url: `/api/v1/discovery/recommendations${query ? `?${query}` : ""}`,
      headers: request.headers,
    });
    return reply.status(recommendations.statusCode).send(recommendations.json());
  });

  app.post("/discovery/jobs/bulk", { preHandler: requireAdmin }, async (request, reply) => {
    const bulkJobSchema = z
      .object({
        source: sourceSchema,
        location: z.string().min(1),
        niche: z.string().min(1),
        max_results: z.number().int().min(1).max(1000).default(200),
        cost_cap_usd: z.number().positive().optional(),
        predictive_context: predictiveContextSchema.optional(),
      })
      .superRefine((value, ctx) => {
        if (value.source === "google_places" && value.cost_cap_usd == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cost_cap_usd"],
            message: "Google Places jobs require cost_cap_usd",
          });
        }
      });
    const bulkSchema = z.object({
      jobs: z.array(bulkJobSchema).min(1).max(200),
    });

    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const jobDefs = parsed.data.jobs.map((j) => ({
      source: j.source,
      location: j.location,
      niche: j.niche,
      max_results: j.max_results,
      cost_cap_usd: j.cost_cap_usd ?? null,
      estimated_cost_usd: j.source === "google_places" ? estimateGooglePlacesBatchCost(j.max_results) : null,
      source_params: j.predictive_context ?? null,
    }));

    const totalGpCostUsd = jobDefs.reduce((sum, j) => sum + (j.estimated_cost_usd ?? 0), 0);
    if (totalGpCostUsd > 0) {
      const budget = await getGooglePlacesBudgetStatus();
      if (budget != null && totalGpCostUsd > budget.budget_remaining) {
        return reply.status(400).send({
          error: `Total estimated GP cost USD ${totalGpCostUsd.toFixed(2)} exceeds remaining monthly budget USD ${budget.budget_remaining.toFixed(2)}`,
          error_code: "budget_exceeded",
          details: {
            total_estimated_cost_usd: totalGpCostUsd,
            budget_remaining: budget.budget_remaining,
            budget_total: budget.budget_total,
            budget_spent: budget.budget_spent,
          },
        });
      }
    }

    let rows;
    try {
      rows = await bulkInsertDiscoveryJobs(jobDefs, parsed.data.jobs.some((job) => job.predictive_context) ? "predictive_location" : "manual");
    } catch (err) {
      request.log.error({ err }, "bulk discovery job insert failed");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const total_estimated_cost_usd = jobDefs.reduce(
      (sum, j) => sum + (j.estimated_cost_usd ?? 0),
      0
    );
    const insertedRows = rows ?? [];

    return reply.status(201).send({
      data: { ids: insertedRows.map((r) => r.id), count: insertedRows.length, total_estimated_cost_usd },
    });
  });

  app.get("/discovery/coverage", { preHandler: requireAdmin }, async (request, reply) => {
    const query = new URLSearchParams(request.query as Record<string, string>).toString();
    const recommendations = await app.inject({
      method: "GET",
      url: `/api/v1/discovery/recommendations${query ? `?${query}` : ""}`,
      headers: request.headers,
    });

    if (recommendations.statusCode !== 200) {
      return reply.status(recommendations.statusCode).send(recommendations.json());
    }

    const body = recommendations.json() as { data: ReturnType<typeof buildDiscoveryRecommendations> };
    return reply.status(200).send({
      data: {
        coverage_gaps_global: body.data.coverage_gaps_global,
        coverage_gaps_by_location: body.data.coverage_gaps_by_location,
        supported_sources: supportedDiscoverySources(),
      },
    });
  });

  // GET /admin/geo/zone-leads — individual leads for a zone (individual map mode)
  app.get("/admin/geo/zone-leads", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = zoneLeadsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", error_code: "invalid_query", details: parsed.error.flatten().fieldErrors });
    }
    const { location_key, parent_location_key, grid_location_key, limit } = parsed.data;
    const { filters: densityFilters, zoneIds } = buildLeadDensityFiltersFromQuery(parsed.data);
    const parsedLocationKey = location_key ? parseGranularLocationKey(location_key) : null;
    const requestedParentLocationKey = parent_location_key ?? parsedLocationKey?.parent_location_key ?? "";
    const requestedGridLocationKey = grid_location_key ?? parsedLocationKey?.grid_location_key ?? null;

    if (!requestedParentLocationKey) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
        details: { location_key: ["parent_location_key could not be resolved"] },
      });
    }

    let all: GeoZoneLeadRow[];
    try {
      all = await loadZoneLeadRows(request);
    } catch {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
    const scoped = all.filter((lead) => buildLeadLocationKey((lead.address ?? "").trim()) === requestedParentLocationKey);
    const matching = [];
    for (const lead of scoped) {
      if (!matchesZoneIdsFilter(lead, zoneIds)) continue;
      const rawCoordinate = getPrimaryCoordinate(lead);
      if (!matchesLeadDensityFilters(lead, densityFilters, rawCoordinate)) continue;
      const mapPoint = await resolveZoneLocationMatch(lead, requestedParentLocationKey, requestedGridLocationKey);
      if (mapPoint) {
        matching.push({
          ...lead,
          prospect_score: asNullableNumber(lead.prospect_score),
          rating: asNullableNumber(lead.rating),
          review_count: asNullableNumber(lead.review_count),
          map_point: mapPoint,
        });
      }
    }

    const page = matching.slice(0, limit);
    return reply.status(200).send({ data: page, total: matching.length, has_more: matching.length > limit });
  });
}
