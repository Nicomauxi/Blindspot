"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import {
  getLeadDensity,
  getOutreachStats,
  getStatsOverview,
  listDiscoveryJobs,
  listPipelineRuns,
  type DiscoveryJob,
  type DiscoveryMapDensityLocation,
  type PipelineRun,
  type StatsOverview,
  type StatsOutreachRow,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { computeLocationCentroid } from "@/lib/location-density-map";
import { formatRelative } from "@/lib/utils";
import { AdminPageLayout, SectionCard, StatCard } from "@/components/admin-shell";
import { LeadExplorer } from "@/components/lead-explorer";

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
  const router = useRouter();

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [outreachStats, setOutreachStats] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [densityLocations, setDensityLocations] = useState<DiscoveryMapDensityLocation[]>([]);
  const [densityLoading, setDensityLoading] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);

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
    setMapMounted(true);
    getLeadDensity(token, { prospect_score_gte: 0 })
      .then((res) => setDensityLocations(res.data.locations))
      .catch(() => {})
      .finally(() => setDensityLoading(false));
  }, [token, role]);

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
          description="Densidad comercial por zona. Hacé clic en una zona para explorar sus leads en el Lead Explorer."
          actions={
            <Link href="/admin/discovery" className="text-xs font-medium text-sky-600 hover:underline">
              Vista completa →
            </Link>
          }
        >
          <div className="relative h-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
            {densityLoading && densityLocations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Cargando mapa...
              </div>
            ) : !mapMounted ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Inicializando mapa...
              </div>
            ) : densityLocations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Sin datos de densidad disponibles.{" "}
                <Link href="/admin/discovery" className="ml-1 text-sky-400 hover:underline">
                  Ejecutar discovery
                </Link>
              </div>
            ) : (
              <MapContainer
                center={[-32.5228, -55.7658]}
                zoom={7}
                scrollWheelZoom={false}
                className="location-density-leaflet h-full w-full"
              >
                <TileLayer
                  attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {densityLocations.map((location) => {
                  const centroid = computeLocationCentroid(location);
                  if (!centroid) return null;
                  const radius = 7 + (location.commercial_density_score / 100) * 15;
                  return (
                    <CircleMarker
                      key={location.location_key}
                      center={[centroid.lat, centroid.lng]}
                      radius={radius}
                      pathOptions={{
                        color: "#dbeafe",
                        fillColor: "#38bdf8",
                        fillOpacity: 0.6,
                        weight: 1.4,
                      }}
                      eventHandlers={{
                        click: () => router.push(`/admin/leads?q=${encodeURIComponent(location.location_label)}`),
                      }}
                    >
                      <Popup>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-900">{location.location_label}</p>
                          <p className="text-xs text-slate-600">{location.lead_count} leads · {location.hot_leads_count} hot</p>
                          <p className="text-xs text-slate-600">Score promedio {location.avg_prospect_score.toFixed(1)}</p>
                          <button
                            type="button"
                            onClick={() => router.push(`/admin/leads?q=${encodeURIComponent(location.location_label)}`)}
                            className="block text-xs font-medium text-sky-600 hover:underline"
                          >
                            Explorar leads →
                          </button>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            )}
          </div>
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
          <LeadExplorer mode="embedded" initialFilters={{ minScore: "55", sortValue: "prospect_score:desc" }} pageSize={6} />
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
