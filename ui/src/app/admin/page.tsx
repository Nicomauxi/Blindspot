"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getZoneLeads,
  getLeadDensity,
  getOutreachStats,
  getStatsOverview,
  listDiscoveryJobs,
  listPipelineRuns,
  type DiscoveryJob,
  type DiscoveryLeadDensityFilters,
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
import { LocationDensityMap } from "@/components/location-density-map";

function aggregateOutreach(rows: StatsOutreachRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
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
  const [densityLoading, setDensityLoading] = useState(false);
  const [densityFilters, setDensityFilters] = useState<DiscoveryLeadDensityFilters>({ prospect_score_gte: 0, limit: 4000 });
  const [selectedLocationKey, setSelectedLocationKey] = useState<string | null>(null);
  const [zoneLeads, setZoneLeads] = useState<ZoneLead[] | null>(null);
  const [zoneLeadsTotal, setZoneLeadsTotal] = useState(0);
  const [zoneLeadsLoading, setZoneLeadsLoading] = useState(false);

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
    setDensityLoading(true);
    getLeadDensity(token, densityFilters)
      .then((res) => setDensityLocations(res.data.locations))
      .catch(() => {})
      .finally(() => setDensityLoading(false));
  }, [densityFilters, token, role]);

  async function handleDrillDown(location: DiscoveryMapDensityLocation) {
    if (!token) return;
    setSelectedLocationKey(location.location_key);
    setZoneLeadsLoading(true);
    try {
      const [, gridLocationKey] = location.location_key.split("::", 2);
      const response = await getZoneLeads(token, {
        location_key: location.location_key,
        parent_location_key: location.parent_location_key,
        ...(gridLocationKey ? { grid_location_key: gridLocationKey } : {}),
        limit: 200,
      });
      setZoneLeads(response.data);
      setZoneLeadsTotal(response.total);
    } catch {
      setZoneLeads([]);
      setZoneLeadsTotal(0);
    } finally {
      setZoneLeadsLoading(false);
    }
  }

  const selectedLocation = selectedLocationKey
    ? densityLocations.find((location) => location.location_key === selectedLocationKey) ?? null
    : null;
  const selectedGridLocationKey = selectedLocationKey?.split("::", 2)[1] ?? null;
  const geoSelection = selectedLocation && selectedGridLocationKey
    ? {
        label: selectedLocation.location_label,
        parent_location_keys: [selectedLocation.parent_location_key],
        grid_location_keys: [selectedGridLocationKey],
      }
    : undefined;

  const responses = (outreachStats.responded ?? 0) + (outreachStats.interested ?? 0) + (outreachStats.closed_won ?? 0);

  return (
    <AdminPageLayout
      eyebrow="Centro de mando"
      title="Inicio"
      description="Entrá por prioridades comerciales: leads accionables y alertas técnicas visibles sin cambiar de pantalla."
      actions={
        <>
          <Link href="/admin/leads?prospect_score_gte=70" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100">
            Ver hot leads
          </Link>
          <Link href="/admin/help" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            Cómo usar Blindspot
          </Link>
        </>
      }
    >
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard label="Leads visibles" value={loading ? "..." : stats?.total_leads.toLocaleString("es-UY") ?? 0} hint="Inventario actual del usuario en el panel" />
        <StatCard label="Outreach registrado" value={loading ? "..." : stats?.total_outreach.toLocaleString("es-UY") ?? 0} hint={`Respuestas o interés detectado: ${responses}`} tone="info" />
      </div>

      {role === "admin" ? (
        <SectionCard
          title="Mapa de leads"
          description="Mismo mapa y mismos controles que Discovery. Acá la selección sirve para acotar el universo comercial que trabajás en Inicio."
          actions={
            <Link href="/admin/discovery" className="text-xs font-medium text-sky-600 hover:underline">
              Vista completa →
            </Link>
          }
        >
          <LocationDensityMap
            locations={densityLocations}
            selectedLocationKey={selectedLocationKey}
            onSelect={(location) => setSelectedLocationKey(location.location_key)}
            onSelectWithDrill={handleDrillDown}
            filters={densityFilters}
            onFiltersChange={setDensityFilters}
            loading={densityLoading}
            zoneLeads={zoneLeads}
            zoneLeadsTotal={zoneLeadsTotal}
            zoneLeadsLoading={zoneLeadsLoading}
          />
        </SectionCard>
      ) : null}

      {(runs.some((run) => run.status === "failed" || run.status === "partial") || jobs.some((job) => job.status === "failed")) ? (
        <SectionCard title="Alertas" description="Solo lo que cambia decisión o requiere intervención.">
          <div className="space-y-3 text-sm">
            {runs.some((run) => run.status === "failed" || run.status === "partial") ? <AlertRow tone="warn" title="Runs recientes con incidencias" description="Revisá Automatizaciones o Calidad antes de confiar en todo el dataset." /> : null}
            {jobs.some((job) => job.status === "failed") ? <AlertRow tone="warn" title="Discovery con fallas" description="Hay jobs de captación que no terminaron correctamente." /> : null}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr,0.65fr]">
        <SectionCard title="Leads para revisar" description="La misma lógica del Lead Explorer, embebida para abrir y filtrar sin salir de Inicio.">
          <LeadExplorer
            mode="embedded"
            initialFilters={{ minScore: "55", sortValue: "prospect_score:desc" }}
            geoSelection={geoSelection}
            onGeoSelectionClear={() => {
              setSelectedLocationKey(null);
              setZoneLeads(null);
              setZoneLeadsTotal(0);
            }}
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

function AlertRow({ tone, title, description }: { tone: "warn" | "info"; title: string; description: string }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${tone === "warn" ? "border-amber-200 bg-amber-50" : "border-sky-200 bg-sky-50"}`}>
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}
