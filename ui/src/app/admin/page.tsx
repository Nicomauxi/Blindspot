"use client";

import { HOT_LEAD_THRESHOLD } from "@/lib/hot-leads";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getZoneLeads,
  getLeadDensity,
  getOutreachStats,
  getStatsOverview,
  listDiscoveryJobs,
  listGeoZones,
  listNicheAliasGroups,
  listPipelineRuns,
  type DiscoveryGeoZone,
  type DiscoveryHeatMetric,
  type DiscoveryJob,
  type DiscoveryLeadDensityFilters,
  type DiscoveryLeadDensityMeta,
  type DiscoveryMapViewportBounds,
  type NicheAliasGroup,
  type DiscoveryMapDensityLocation,
  type PipelineRun,
  type StatsOverview,
  type StatsOutreachRow,
  type ZoneLead,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatRelative } from "@/lib/utils";
import { AdminPageLayout, SectionCard, StatCard } from "@/components/admin-shell";
import { LeadExplorer } from "@/components/lead-explorer";
import { LeadReviewMap } from "@/components/lead-review-map";
import { areLeadDensityFiltersEqual, buildLeadExplorerGeoSelection, buildZoneLeadRequest } from "@/lib/location-density-map";

const DEFAULT_DENSITY_FILTERS: DiscoveryLeadDensityFilters = { prospect_score_gte: 0, limit: 4000, heat_metric: "mixed" };

function aggregateOutreach(rows: StatsOutreachRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function describeZoneSelection(zoneIds: string[] | undefined, zones: DiscoveryGeoZone[]): string | null {
  if (!zoneIds || zoneIds.length === 0) return null;
  const labels = zoneIds.map((zoneId) => zones.find((zone) => zone.zone_id === zoneId)?.label ?? zoneId);
  if (labels.length === 1) return labels[0] ?? null;
  return `${labels.length} zonas`;
}

export default function AdminHomePage() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [outreachStats, setOutreachStats] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [densityLocations, setDensityLocations] = useState<DiscoveryMapDensityLocation[]>([]);
  const [densityMeta, setDensityMeta] = useState<DiscoveryLeadDensityMeta | null>(null);
  const [densityLoading, setDensityLoading] = useState(false);
  const [densityError, setDensityError] = useState<string | null>(null);
  const [draftDensityFilters, setDraftDensityFilters] = useState<DiscoveryLeadDensityFilters>(DEFAULT_DENSITY_FILTERS);
  const [appliedDensityFilters, setAppliedDensityFilters] = useState<DiscoveryLeadDensityFilters>(DEFAULT_DENSITY_FILTERS);
  const [mapViewport, setMapViewport] = useState<{ zoom?: number; bbox?: DiscoveryMapViewportBounds }>({});
  const [viewportLeads, setViewportLeads] = useState<ZoneLead[]>([]);
  const [draftSelectedLocationKey, setDraftSelectedLocationKey] = useState<string | null>(null);
  const [appliedSelectedLocationKey, setAppliedSelectedLocationKey] = useState<string | null>(null);
  const [appliedLocationSelection, setAppliedLocationSelection] = useState<Pick<DiscoveryMapDensityLocation, "location_key" | "location_label" | "parent_location_key"> | null>(null);
  const [zoneOptions, setZoneOptions] = useState<DiscoveryGeoZone[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [zoneOptionsLoading, setZoneOptionsLoading] = useState(false);
  const [nicheGroups, setNicheGroups] = useState<NicheAliasGroup[]>([]);
  const [nicheGroupsError, setNicheGroupsError] = useState<string | null>(null);
  const [zoneOptionsError, setZoneOptionsError] = useState<string | null>(null);
  const [zoneLeads, setZoneLeads] = useState<ZoneLead[] | null>(null);
  const [zoneLeadsTotal, setZoneLeadsTotal] = useState(0);
  const [zoneLeadsLoading, setZoneLeadsLoading] = useState(false);
  const [zoneLeadsError, setZoneLeadsError] = useState<string | null>(null);
  const previousDensityFilterKey = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;

    setLoading(true);
    Promise.all([
      getStatsOverview(token),
      getOutreachStats(token),
      role === "admin" ? listPipelineRuns(token, { limit: 5 }).catch(() => ({ data: [], next_cursor: null, total: 0 })) : Promise.resolve({ data: [], next_cursor: null, total: 0 }),
      role === "admin" ? listDiscoveryJobs(token, { limit: 5 }).catch(() => ({ data: [], next_cursor: null, total: 0 })) : Promise.resolve({ data: [], next_cursor: null, total: 0 }),
    ])
      .then(([statsRes, outreachRes, runsRes, jobsRes]) => {
        setStats(statsRes.data);
        setOutreachStats(aggregateOutreach(outreachRes.data));
        setRuns(runsRes.data);
        setJobs(jobsRes.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar el inicio"))
      .finally(() => setLoading(false));
  }, [role, token]);

  useEffect(() => {
    if (!token || role !== "admin") return;
    const filterKey = JSON.stringify(appliedDensityFilters);
    const filtersChanged = previousDensityFilterKey.current !== filterKey;
    previousDensityFilterKey.current = filterKey;
    setDensityLoading(true);
    const timeout = window.setTimeout(() => {
      getLeadDensity(token, { ...appliedDensityFilters, ...mapViewport })
        .then((res) => {
          setDensityLocations(res.data.locations);
          setDensityMeta(res.data.meta);
          setViewportLeads(res.data.viewport_leads ?? []);
          setDensityError(null);
          setDraftSelectedLocationKey((current) => res.data.locations.some((location) => location.location_key === current) ? current : null);
        })
        .catch((err) => {
          setDensityLocations([]);
          setDensityMeta(null);
          setViewportLeads([]);
          setDensityError(err instanceof Error ? err.message : "No se pudo cargar el mapa de leads.");
          setDraftSelectedLocationKey(null);
        })
        .finally(() => setDensityLoading(false));
    }, filtersChanged ? 0 : 180);

    return () => {
      window.clearTimeout(timeout);
      setDensityLoading(false);
    };
  }, [appliedDensityFilters, mapViewport, token, role]);

  useEffect(() => {
    if (!token) return;
    void listNicheAliasGroups(token)
      .then((response) => { setNicheGroups(response.data); setNicheGroupsError(null); })
      .catch(() => { setNicheGroups([]); setNicheGroupsError("No se pudo cargar la configuración de nichos. Algunos filtros pueden no estar disponibles."); });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setZoneOptionsLoading(true);
    const timeout = window.setTimeout(() => {
      void listGeoZones(token, { q: zoneSearch || undefined, limit: 60 })
        .then((response) => {
          setZoneOptions(response.data);
          setZoneOptionsError(null);
        })
        .catch((err) => {
          setZoneOptions([]);
          setZoneOptionsError(err instanceof Error ? err.message : "No se pudieron cargar las zonas.");
        })
        .finally(() => setZoneOptionsLoading(false));
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      setZoneOptionsLoading(false);
    };
  }, [token, zoneSearch]);

  const selectedLocation = draftSelectedLocationKey
    ? densityLocations.find((location) => location.location_key === draftSelectedLocationKey) ?? null
    : null;
  useEffect(() => {
    if (!token || !selectedLocation) {
      setZoneLeads(null);
      setZoneLeadsTotal(0);
      return;
    }

    setZoneLeads([]);
    setZoneLeadsTotal(0);
    setZoneLeadsLoading(true);
    void getZoneLeads(token, { ...buildZoneLeadRequest(selectedLocation), ...appliedDensityFilters })
      .then((response) => {
        setZoneLeads(response.data);
        setZoneLeadsTotal(response.total);
        setZoneLeadsError(null);
      })
      .catch((err) => {
        setZoneLeads([]);
        setZoneLeadsTotal(0);
        setZoneLeadsError(err instanceof Error ? err.message : "No se pudieron cargar los leads de la zona seleccionada.");
      })
      .finally(() => setZoneLeadsLoading(false));
  }, [appliedDensityFilters, selectedLocation, token]);

  function handleDrillDown(location: DiscoveryMapDensityLocation) {
    setDraftSelectedLocationKey(location.location_key);
  }

  function applyMapSelection() {
    setAppliedDensityFilters(draftDensityFilters);
    setAppliedSelectedLocationKey(draftSelectedLocationKey);
    setAppliedLocationSelection(selectedLocation
      ? {
          location_key: selectedLocation.location_key,
          location_label: selectedLocation.location_label,
          parent_location_key: selectedLocation.parent_location_key,
        }
      : null);
  }

  function cancelMapSelection() {
    setDraftDensityFilters(appliedDensityFilters);
    setDraftSelectedLocationKey(appliedSelectedLocationKey);
  }

  function clearAppliedAndDraftSelection() {
    setDraftSelectedLocationKey(null);
    setAppliedSelectedLocationKey(null);
    setAppliedLocationSelection(null);
    setDraftDensityFilters((current) => ({ ...current, zone_ids: undefined }));
    setAppliedDensityFilters((current) => ({ ...current, zone_ids: undefined }));
    setZoneLeads(null);
    setZoneLeadsTotal(0);
  }

  function clearMapSelection() {
    setDraftDensityFilters(DEFAULT_DENSITY_FILTERS);
    setAppliedDensityFilters(DEFAULT_DENSITY_FILTERS);
    clearAppliedAndDraftSelection();
    setZoneSearch("");
  }

  const appliedZoneLabel = describeZoneSelection(appliedDensityFilters.zone_ids, zoneOptions);
  const draftZoneLabel = describeZoneSelection(draftDensityFilters.zone_ids, zoneOptions);
  const geoSelection = appliedLocationSelection
    ? buildLeadExplorerGeoSelection(appliedLocationSelection)
    : appliedDensityFilters.zone_ids?.length
      ? {
          label: appliedZoneLabel ?? "Zona geográfica",
          parent_location_keys: appliedDensityFilters.zone_ids,
        }
      : undefined;
  const hasPendingMapChanges = !areLeadDensityFiltersEqual(draftDensityFilters, appliedDensityFilters) || draftSelectedLocationKey !== appliedSelectedLocationKey;

  const responses = (outreachStats.responded ?? 0) + (outreachStats.interested ?? 0) + (outreachStats.closed_won ?? 0);

  return (
    <AdminPageLayout
      eyebrow="Centro de mando"
      title="Inicio"
      description="Entrá por prioridades comerciales: leads accionables y contexto operativo sin salir de Inicio."
      actions={
        <>
          <Link href={`/admin/leads?prospect_score_gte=${HOT_LEAD_THRESHOLD}`} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100">
            Ver hot leads
          </Link>
          <Link href="/admin/help" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            Cómo usar Blindspot
          </Link>
        </>
      }
    >
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {nicheGroupsError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">{nicheGroupsError}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard label="Leads visibles" value={loading ? "..." : stats?.total_leads.toLocaleString("es-UY") ?? 0} hint="Inventario actual del usuario en el panel" />
        <StatCard label="Outreach registrado" value={loading ? "..." : stats?.total_outreach.toLocaleString("es-UY") ?? 0} hint={`Respuestas o interés detectado: ${responses}`} tone="info" />
      </div>

      {role === "admin" ? (
        <SectionCard
          title="Mapa de leads"
          description="Mismo mapa y mismos controles que Discovery. Acá la selección sirve para acotar el universo comercial que trabajás en Inicio."
        >
          <LeadReviewMap
            locations={densityLocations}
            meta={densityMeta}
            loadError={densityError}
            selectedLocationKey={draftSelectedLocationKey}
            onSelect={(location) => setDraftSelectedLocationKey(location.location_key)}
            onSelectWithDrill={handleDrillDown}
            filters={draftDensityFilters}
            onFiltersChange={setDraftDensityFilters}
            loading={densityLoading}
            viewportLeads={viewportLeads}
            onViewportChange={setMapViewport}
            zones={zoneOptions}
            zoneSearch={zoneSearch}
            onZoneSearchChange={setZoneSearch}
            zonesLoading={zoneOptionsLoading}
            zonesError={zoneOptionsError}
            zoneLeads={zoneLeads}
            zoneLeadsTotal={zoneLeadsTotal}
            zoneLeadsLoading={zoneLeadsLoading}
            zoneLeadsError={zoneLeadsError}
            nicheGroups={nicheGroups}
            allowIconEditing={role === "admin"}
            pendingChanges={hasPendingMapChanges}
            pendingSelectionLabel={selectedLocation?.location_label ?? draftZoneLabel}
            appliedSelectionLabel={appliedLocationSelection?.location_label ?? appliedZoneLabel}
            onApplySelection={applyMapSelection}
            onCancelSelection={cancelMapSelection}
            onClearSelection={clearMapSelection}
          />
        </SectionCard>
      ) : null}


      <div className="grid gap-4 xl:grid-cols-[1.35fr,0.65fr]">
        <SectionCard title="Leads para revisar" description="La misma lógica del Lead Explorer, embebida para abrir y filtrar sin salir de Inicio.">
          <LeadExplorer
            mode="embedded"
            initialFilters={{ minScore: "55", sortValue: "prospect_score:desc" }}
            geoSelection={geoSelection}
            onGeoSelectionClear={clearAppliedAndDraftSelection}
            pageSize={10}
          />
        </SectionCard>

        <SectionCard title="Actividad del sistema" description="Contexto útil para no separar operación comercial y soporte.">
          <div className="space-y-4 text-sm">
            {role === "admin" ? (
              <>
                <div>
                  <p className="font-medium text-slate-800">Runs recientes</p>
                  <div className="mt-2 space-y-2">
                    {runs.slice(0, 3).map((run) => (
                      <div key={run.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-700">{run.status}</span>
                        <span className="text-slate-500">{formatRelative(run.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium text-slate-800">Captación reciente</p>
                  <div className="mt-2 space-y-2">
                    {jobs.slice(0, 3).map((job) => (
                      <div key={job.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-800">{job.source}</span>
                          <span>{job.status}</span>
                        </div>
                        <p className="mt-1">{job.location} · {job.niche ?? "sin niche"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </AdminPageLayout>
  );
}

