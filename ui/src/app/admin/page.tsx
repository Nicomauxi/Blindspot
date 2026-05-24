"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getCostsOverview,
  getOutreachStats,
  getStatsOverview,
  listCampaigns,
  listDiscoveryJobs,
  listPipelineRuns,
  type Campaign,
  type CostsOverview,
  type DiscoveryJob,
  type PipelineRun,
  type StatsOverview,
  type StatsOutreachRow,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
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

  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [costs, setCosts] = useState<CostsOverview | null>(null);
  const [outreachStats, setOutreachStats] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    setLoading(true);
    Promise.all([
      getStatsOverview(token),
      getOutreachStats(token),
      listCampaigns(token).catch(() => ({ data: [] })),
      role === "admin" ? listPipelineRuns(token, { limit: 5 }).catch(() => ({ data: [], next_cursor: null, total: 0 })) : Promise.resolve({ data: [], next_cursor: null, total: 0 }),
      role === "admin" ? listDiscoveryJobs(token, { limit: 5 }).catch(() => ({ data: [], next_cursor: null, total: 0 })) : Promise.resolve({ data: [], next_cursor: null, total: 0 }),
      role === "admin" ? getCostsOverview(token).catch(() => null) : Promise.resolve(null),
    ])
      .then(([statsRes, outreachRes, campaignsRes, runsRes, jobsRes, costsRes]) => {
        setStats(statsRes.data);
        setOutreachStats(aggregateOutreach(outreachRes.data));
        setCampaigns(campaignsRes.data);
        setRuns(runsRes.data);
        setJobs(jobsRes.data);
        setCosts(costsRes?.data ?? null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar el inicio"))
      .finally(() => setLoading(false));
  }, [role, token]);

  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active").length;
  const pausedCampaigns = campaigns.filter((campaign) => campaign.status === "paused").length;
  const responses = (outreachStats.responded ?? 0) + (outreachStats.interested ?? 0) + (outreachStats.closed_won ?? 0);
  const budgetRemaining = costs?.google_places?.budget_remaining ?? null;
  const queuedJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;

  return (
    <AdminPageLayout
      eyebrow="Centro de mando"
      title="Inicio"
      description="Entrá por prioridades comerciales: leads accionables, campañas activas y alertas técnicas visibles sin cambiar de pantalla."
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Leads visibles" value={loading ? "..." : stats?.total_leads.toLocaleString("es-UY") ?? 0} hint="Inventario actual del usuario en el panel" />
        <StatCard label="Outreach registrado" value={loading ? "..." : stats?.total_outreach.toLocaleString("es-UY") ?? 0} hint={`Respuestas o interés detectado: ${responses}`} tone="info" />
        <StatCard label="Campañas activas" value={loading ? "..." : activeCampaigns} hint={pausedCampaigns > 0 ? `${pausedCampaigns} pausadas` : "Sin campañas pausadas"} tone={activeCampaigns > 0 ? "good" : "default"} />
        <StatCard label="Discovery en cola" value={loading ? "..." : queuedJobs} hint={budgetRemaining != null ? `Budget GP restante: USD ${budgetRemaining.toFixed(2)}` : "Sin lectura de presupuesto disponible"} tone="warn" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <SectionCard title="Colas de trabajo" description="Atajos de barrido para admins comerciales.">
          <div className="grid gap-3 md:grid-cols-2">
            <QuickQueueCard href="/admin/leads?prospect_score_gte=70" title="Hot leads" description="Oportunidades con score alto para priorizar contacto." />
            <QuickQueueCard href="/admin/leads?contact_tier=A" title="Tier A" description="Leads con contacto fuerte y mejor base de acción." />
            <QuickQueueCard href="/admin/leads?source=google_places" title="Google Places" description="Barrido por fuente para validar calidad y novedades." />
            <QuickQueueCard href="/admin/crm" title="Seguimiento comercial" description="Abrir respuestas, outcomes y registros recientes." />
          </div>
        </SectionCard>

        <SectionCard title="Alertas" description="Solo lo que cambia decisión o requiere intervención.">
          <div className="space-y-3 text-sm">
            {budgetRemaining != null ? <AlertRow tone={costs?.google_places?.over_alert ? "warn" : "info"} title="Presupuesto Google Places" description={`Restante: USD ${budgetRemaining.toFixed(2)}`} /> : null}
            {runs.some((run) => run.status === "failed" || run.status === "partial") ? <AlertRow tone="warn" title="Runs recientes con incidencias" description="Revisá Automatizaciones o Calidad antes de confiar en todo el dataset." /> : null}
            {jobs.some((job) => job.status === "failed") ? <AlertRow tone="warn" title="Discovery con fallas" description="Hay jobs de captación que no terminaron correctamente." /> : null}
            {activeCampaigns === 0 ? <AlertRow tone="info" title="Sin campañas activas" description="Hay outreach registrado pero no hay una campaña activa visible." /> : null}
            {!loading && budgetRemaining == null && activeCampaigns > 0 && runs.length === 0 ? <AlertRow tone="info" title="Sin alertas críticas" description="El panel no encontró incidencias relevantes para hoy." /> : null}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr,0.65fr]">
        <SectionCard title="Leads para revisar" description="La misma lógica del Lead Explorer, embebida para abrir y filtrar sin salir de Inicio.">
          <LeadExplorer mode="embedded" initialFilters={{ minScore: "55", sortValue: "prospect_score:desc" }} pageSize={6} />
        </SectionCard>

        <SectionCard title="Actividad del sistema" description="Contexto útil para no separar operación comercial y soporte.">
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-slate-800">Campañas</p>
              <p className="mt-1 text-slate-500">{activeCampaigns} activas · {pausedCampaigns} pausadas · {campaigns.length - activeCampaigns - pausedCampaigns} cerradas</p>
            </div>
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

function QuickQueueCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition-colors hover:border-sky-200 hover:bg-sky-50">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </Link>
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
