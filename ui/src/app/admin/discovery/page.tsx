"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createDiscoveryJobBatch,
  getDiscoveryRecommendations,
  getLeadDensity,
  listDiscoveryJobBatches,
  listDiscoveryJobs,
  patchDiscoveryJobBatch,
  type DiscoveryCoverageGap,
  type DiscoveryJob,
  type DiscoveryJobBatch,
  type DiscoveryLocationDensity,
  type DiscoveryRecommendationData,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { AdminPageLayout, SectionCard, StatCard } from "@/components/admin-shell";
import { LocationDensityMap } from "@/components/location-density-map";

const SOURCES = ["yelu", "pedidosya", "mintur", "osm", "google_places"] as const;
const PROFILES = ["A", "B", "C", "D"] as const;
const JOB_STATUS_COLORS: Record<string, string> = {
  queued: "bg-amber-50 text-amber-700",
  running: "bg-sky-50 text-sky-700",
  partial: "bg-violet-50 text-violet-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  paused: "bg-orange-50 text-orange-700",
  cancelled: "bg-slate-100 text-slate-600",
};

type DiscoverySection = "batches" | "jobs" | "recommendations" | "density";

type ComposerState = {
  sources: string[];
  location: string;
  niche: string;
  max_results: string;
  cpu_budget: "conservative" | "balanced" | "aggressive";
  google_profile: "A" | "B" | "C" | "D";
  google_concurrency: string;
  google_cost_cap_usd: string;
};

const EMPTY_COMPOSER: ComposerState = {
  sources: ["yelu", "mintur"],
  location: "Montevideo",
  niche: "",
  max_results: "200",
  cpu_budget: "balanced",
  google_profile: "B",
  google_concurrency: "5",
  google_cost_cap_usd: "",
};

function estimateGoogleCost(maxResults: number): number {
  const safe = Math.max(1, maxResults);
  return Math.ceil(safe / 20) * 0.035 + safe * 0.025;
}

function toggleSource(current: string[], source: string): string[] {
  return current.includes(source) ? current.filter((item) => item !== source) : [...current, source];
}

function PrefillBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={cn("rounded-full px-2 py-1 text-xs font-medium", active ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500")}>
      {label}
    </span>
  );
}

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function SectionWarning({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>;
}

export default function DiscoveryPage() {
  const token = useAuthStore((state) => state.token);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [recommendations, setRecommendations] = useState<DiscoveryRecommendationData | null>(null);
  const [density, setDensity] = useState<DiscoveryLocationDensity[]>([]);
  const [batches, setBatches] = useState<DiscoveryJobBatch[]>([]);
  const [legacyJobs, setLegacyJobs] = useState<DiscoveryJob[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [selectedLocationKey, setSelectedLocationKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<DiscoverySection, string | null>>({
    batches: null,
    jobs: null,
    recommendations: null,
    density: null,
  });
  const [prefillNote, setPrefillNote] = useState<string | null>(null);

  const includesGoogle = composer.sources.includes("google_places");
  const maxResults = Math.max(1, Number(composer.max_results) || 0);
  const estimatedGoogleCost = includesGoogle ? estimateGoogleCost(maxResults) : 0;
  const estimatedBatchCost = composer.sources.reduce((sum, source) => sum + (source === "google_places" ? estimatedGoogleCost : 0), 0);
  const remainingBudget = recommendations?.google_places_budget?.budget_remaining ?? null;
  const configuredCap = includesGoogle ? Number(composer.google_cost_cap_usd || 0) : 0;
  const effectiveGoogleCap = includesGoogle ? Math.min(configuredCap || Number.POSITIVE_INFINITY, remainingBudget ?? Number.POSITIVE_INFINITY) : null;
  const batchWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (composer.sources.length === 0) warnings.push("Seleccioná al menos una fuente.");
    if (!composer.location.trim()) warnings.push("La ubicación es obligatoria.");
    if (includesGoogle && !composer.google_cost_cap_usd.trim()) warnings.push("Google Places requiere cost cap USD antes de crear el lote.");
    if (includesGoogle && remainingBudget != null && remainingBudget <= 0) warnings.push("El presupuesto mensual de Google Places está agotado.");
    if (includesGoogle && configuredCap > 0 && estimatedGoogleCost > configuredCap) warnings.push("La estimación conservadora supera el cap configurado para Google Places.");
    return warnings;
  }, [composer.google_cost_cap_usd, composer.location, composer.sources.length, configuredCap, estimatedGoogleCost, includesGoogle, remainingBudget]);

  async function loadPage() {
    if (!token) return;
    setLoading(true);
    const results = await Promise.allSettled([
      listDiscoveryJobBatches(token, { include_jobs: true, limit: 20 }),
      listDiscoveryJobs(token, { limit: 50 }),
      getDiscoveryRecommendations(token, { sources: composer.sources, location: composer.location || undefined, niche: composer.niche || undefined, limit: 20 }),
      getLeadDensity(token, { location: selectedLocationKey ?? undefined, limit: 20 }),
    ]);

    const nextErrors: Record<DiscoverySection, string | null> = {
      batches: null,
      jobs: null,
      recommendations: null,
      density: null,
    };

    const [batchRes, jobRes, recommendationRes, densityRes] = results;

    if (batchRes.status === "fulfilled") {
      setBatches(batchRes.value.data);
    } else {
      nextErrors.batches = getErrorMessage(batchRes.reason, "No se pudieron cargar los batches.");
      setBatches([]);
    }

    if (jobRes.status === "fulfilled") {
      setLegacyJobs(jobRes.value.data.filter((job) => !job.batch_id));
    } else {
      nextErrors.jobs = getErrorMessage(jobRes.reason, "No se pudieron cargar los jobs legacy.");
      setLegacyJobs([]);
    }

    if (recommendationRes.status === "fulfilled") {
      setRecommendations(recommendationRes.value.data);
    } else {
      nextErrors.recommendations = getErrorMessage(recommendationRes.reason, "No se pudieron cargar las recomendaciones.");
      setRecommendations(null);
    }

    if (densityRes.status === "fulfilled") {
      setDensity(densityRes.value.data.locations);
    } else {
      nextErrors.density = getErrorMessage(densityRes.reason, "No se pudo cargar el mapa de densidad.");
      setDensity([]);
    }

    setSectionErrors(nextErrors);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedLocationKey]);

  useEffect(() => {
    if (!token) return;
    const timeout = window.setTimeout(() => {
      void getDiscoveryRecommendations(token, {
        sources: composer.sources,
        location: composer.location || undefined,
        niche: composer.niche || undefined,
        limit: 20,
      })
        .then((response) => {
          setRecommendations(response.data);
          setSectionErrors((current) => ({ ...current, recommendations: null }));
        })
        .catch((err) => {
          setRecommendations(null);
          setSectionErrors((current) => ({ ...current, recommendations: getErrorMessage(err, "No se pudieron recalcular las recomendaciones.") }));
        });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [composer.location, composer.niche, composer.sources, token]);

  async function handleCreateBatch() {
    if (!token) return;
    setCreating(true);
    try {
      await createDiscoveryJobBatch(token, {
        sources: composer.sources,
        location: composer.location.trim(),
        niche: composer.niche.trim() || undefined,
        max_results: maxResults,
        cpu_budget: composer.cpu_budget,
        google_places: includesGoogle
          ? {
              profile: composer.google_profile,
              concurrency: Math.max(1, Number(composer.google_concurrency) || 5),
              cost_cap_usd: Number(composer.google_cost_cap_usd),
            }
          : undefined,
        recommendation_origin: prefillNote ? { type: "manual", key: prefillNote } : { type: "manual" },
      });
      setComposer({ ...EMPTY_COMPOSER, location: composer.location, niche: composer.niche });
      setPrefillNote(null);
      await loadPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear lote");
    } finally {
      setCreating(false);
    }
  }

  async function handleBatchAction(id: string, action: "pause" | "resume" | "cancel") {
    if (!token) return;
    try {
      await patchDiscoveryJobBatch(token, id, action);
      await loadPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Error al ${action} lote`);
    }
  }

  function applyGapPrefill(gap: DiscoveryCoverageGap) {
    setComposer((current) => ({
      ...current,
      location: gap.location_label,
      niche: gap.niche,
      sources: Array.from(new Set([...gap.present_sources, ...gap.missing_sources])),
    }));
    setSelectedLocationKey(gap.location_key);
    setPrefillNote(`Gap ${gap.location_label} · ${gap.niche}`);
  }

  function applyLocationPrefill(location: DiscoveryLocationDensity) {
    setComposer((current) => ({ ...current, location: location.location_label }));
    setSelectedLocationKey(location.location_key);
    setPrefillNote(`Ubicación ${location.location_label}`);
  }

  const jobsToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const batchChildren = batches.flatMap((batch) => batch.jobs ?? []);
    return [...batchChildren, ...legacyJobs].filter((job) => job.created_at.slice(0, 10) === today).length;
  }, [batches, legacyJobs]);

  const backlog = useMemo(() => {
    const batchChildren = batches.flatMap((batch) => batch.jobs ?? []);
    return [...batchChildren, ...legacyJobs].filter((job) => ["queued", "running", "paused"].includes(job.status)).length;
  }, [batches, legacyJobs]);

  return (
    <AdminPageLayout
      eyebrow="Captación"
      title="Workspace de discovery"
      description="Planificá lotes multifuente, detectá gaps reales de coverage y activá Google Places solo con cap explícito y contexto de presupuesto."
      actions={<button onClick={() => void loadPage()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Actualizar</button>}
    >
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jobs creados hoy" value={loading ? "..." : jobsToday} hint="Hijos creados hoy, incluyendo batches y jobs legacy" />
        <StatCard label="Backlog activo" value={loading ? "..." : backlog} hint="Queued, running o paused" tone="warn" />
        <StatCard label="Google Places mes" value={recommendations?.monthly_cost != null ? `USD ${recommendations.monthly_cost.toFixed(2)}` : "..."} hint="Costo estimado acumulado de runs completados" tone="info" />
        <StatCard label="Presupuesto restante" value={recommendations?.google_places_budget ? `USD ${recommendations.google_places_budget.budget_remaining.toFixed(2)}` : "..."} hint={recommendations?.google_places_budget?.over_alert ? "Debajo del umbral de alerta" : "Budget disponible para jobs pagos"} tone={recommendations?.google_places_budget?.over_alert ? "warn" : "good"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <SectionCard title="Composer" description="Un submit crea un batch y un job hijo por fuente seleccionada.">
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Fuentes</label>
              <div className="flex flex-wrap gap-2">
                {SOURCES.map((source) => {
                  const active = composer.sources.includes(source);
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setComposer((current) => ({ ...current, sources: toggleSource(current.sources, source) }))}
                      className={cn(
                        "rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                        active ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {source}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">`google_places` queda opt-in explícito y no se preselecciona en recomendaciones.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ubicación</label>
                <input value={composer.location} onChange={(event) => setComposer((current) => ({ ...current, location: event.target.value }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Montevideo" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Niche</label>
                <input value={composer.niche} onChange={(event) => setComposer((current) => ({ ...current, niche: event.target.value }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="restaurante, clínica, gimnasio..." />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Max results</label>
                <input type="number" min={1} max={1000} value={composer.max_results} onChange={(event) => setComposer((current) => ({ ...current, max_results: event.target.value }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CPU budget</label>
                <select value={composer.cpu_budget} onChange={(event) => setComposer((current) => ({ ...current, cpu_budget: event.target.value as ComposerState["cpu_budget"] }))} className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm">
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
            </div>

            {includesGoogle ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile</label>
                    <select value={composer.google_profile} onChange={(event) => setComposer((current) => ({ ...current, google_profile: event.target.value as ComposerState["google_profile"] }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm">
                      {PROFILES.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Concurrency</label>
                    <input type="number" min={1} max={10} value={composer.google_concurrency} onChange={(event) => setComposer((current) => ({ ...current, google_concurrency: event.target.value }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cost cap USD</label>
                    <input type="number" min={0.01} step="0.01" value={composer.google_cost_cap_usd} onChange={(event) => setComposer((current) => ({ ...current, google_cost_cap_usd: event.target.value }))} className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-sm" />
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">Estimación</div>
                    <div className="mt-1">USD {estimatedGoogleCost.toFixed(2)}</div>
                    <div className="mt-2 text-xs text-slate-500">Mes usado: USD {recommendations?.google_places_budget?.budget_spent?.toFixed(2) ?? "0.00"}</div>
                    <div className="text-xs text-slate-500">Remanente: {remainingBudget != null ? `USD ${remainingBudget.toFixed(2)}` : "—"}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Resumen del lote</p>
                  <p className="mt-1 text-xs text-slate-500">Preview vivo de lo que se va a crear.</p>
                </div>
                <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{composer.sources.length} jobs hijos</div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
                <div><span className="text-slate-500">Fuentes:</span> <span className="font-medium text-slate-900">{composer.sources.join(", ") || "—"}</span></div>
                <div><span className="text-slate-500">Costo estimado:</span> <span className="font-medium text-slate-900">USD {estimatedBatchCost.toFixed(2)}</span></div>
                <div><span className="text-slate-500">Cap máximo:</span> <span className="font-medium text-slate-900">{effectiveGoogleCap != null && Number.isFinite(effectiveGoogleCap) ? `USD ${effectiveGoogleCap.toFixed(2)}` : "—"}</span></div>
                <div><span className="text-slate-500">Origen:</span> <span className="font-medium text-slate-900">{prefillNote ?? "manual"}</span></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <PrefillBadge label="Ubicación prefill" active={Boolean(prefillNote && composer.location)} />
                <PrefillBadge label="Niche prefill" active={Boolean(prefillNote && composer.niche)} />
                <PrefillBadge label="Fuentes sugeridas" active={Boolean(prefillNote && composer.sources.length > 0)} />
              </div>
              {batchWarnings.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {batchWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setComposer(EMPTY_COMPOSER); setPrefillNote(null); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Reset</button>
              <button onClick={() => void handleCreateBatch()} disabled={creating || batchWarnings.length > 0} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">
                {creating ? "Creando…" : "Crear batch"}
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Recomendaciones" description="Coverage gaps reales, nichos usados y oportunidades ordenadas por densidad comercial.">
          <div className="space-y-5">
            <SectionWarning message={sectionErrors.recommendations} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Coverage gaps globales</p>
              <div className="mt-3 space-y-3">
                {recommendations?.coverage_gaps_global.length ? recommendations.coverage_gaps_global.map((gap) => (
                  <button key={gap.key} type="button" onClick={() => applyGapPrefill(gap)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-sky-200 hover:bg-sky-50/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{gap.location_label} · {gap.niche}</p>
                        <p className="mt-1 text-xs text-slate-500">Falta en: {gap.missing_sources.join(", ")} · presente en {gap.present_sources.join(", ")}</p>
                      </div>
                      <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">{gap.commercial_density_score}</div>
                    </div>
                  </button>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">No hay gaps para las fuentes y filtros actuales.</div>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Por ubicación</p>
              <div className="mt-3 space-y-3">
                {recommendations?.coverage_gaps_by_location.length ? recommendations.coverage_gaps_by_location.map((group) => (
                  <button key={group.location_key} type="button" onClick={() => applyLocationPrefill({ location_key: group.location_key, location_label: group.location_label, commercial_density_score: group.commercial_density_score, lead_count: 0, hot_leads_count: 0, avg_prospect_score: 0, gps_points: [] })} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-sky-200 hover:bg-sky-50/40">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{group.location_label}</p>
                        <p className="mt-1 text-xs text-slate-500">{group.gaps.length} oportunidades activas</p>
                      </div>
                      <div className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">{group.commercial_density_score}</div>
                    </div>
                  </button>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">Sin oportunidades agrupadas por ubicación.</div>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Nichos sugeridos</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {recommendations?.niche_suggestions.length ? recommendations.niche_suggestions.map((entry) => (
                  <button key={entry.key} type="button" onClick={() => { setComposer((current) => ({ ...current, niche: entry.niche })); setPrefillNote(`Niche ${entry.niche}`); }} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-sky-200 hover:bg-sky-50">
                    {entry.niche}
                    <span className="ml-2 text-xs text-slate-400">{entry.origin === "top_by_source" ? entry.source : entry.count}</span>
                  </button>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">No hay sugerencias de niche disponibles.</div>}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Contexto y mapa" description="Vista agregada por ubicación. Tocar una ubicación filtra recomendaciones y deja prefill listo para el composer.">
        <div className="space-y-4">
          <SectionWarning message={sectionErrors.density} />
          <LocationDensityMap locations={density} selectedLocationKey={selectedLocationKey} onSelect={applyLocationPrefill} />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <SectionCard title="Batches recientes" description="La unidad principal es el lote. Los jobs sin batch siguen visibles como legado.">
          <div className="space-y-3">
            <SectionWarning message={sectionErrors.batches} />
            {batches.length ? batches.map((batch) => (
              <div key={batch.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{batch.location} · {batch.niche ?? "sin niche"}</p>
                      <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", JOB_STATUS_COLORS[batch.status] ?? "bg-slate-100 text-slate-600")}>{batch.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {batch.sources.join(", ")} · estimado USD {Number(batch.estimated_cost_usd ?? 0).toFixed(2)} · real USD {Number(batch.actual_cost_usd ?? 0).toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Creado {formatRelative(batch.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {batch.status === "queued" || batch.status === "running" ? <button onClick={() => void handleBatchAction(batch.id, "pause")} className="text-amber-700 hover:underline">Pausar</button> : null}
                    {batch.status === "queued" || batch.status === "running" || batch.status === "partial" ? <button onClick={() => void handleBatchAction(batch.id, "cancel")} className="text-rose-700 hover:underline">Cancelar</button> : null}
                    {batch.status === "queued" || batch.status === "running" || batch.status === "partial" ? null : <button onClick={() => void handleBatchAction(batch.id, "resume")} className="text-sky-700 hover:underline">Reanudar</button>}
                    <button onClick={() => setExpandedBatchId((current) => current === batch.id ? null : batch.id)} className="text-slate-700 hover:underline">{expandedBatchId === batch.id ? "Ocultar hijos" : "Ver hijos"}</button>
                  </div>
                </div>
                {expandedBatchId === batch.id ? (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Fuente</th>
                          <th className="px-3 py-2 text-left">Estado</th>
                          <th className="px-3 py-2 text-right">Costo</th>
                          <th className="px-3 py-2 text-right">Leads</th>
                          <th className="px-3 py-2 text-left">Run</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(batch.jobs ?? []).map((job) => (
                          <tr key={job.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">{job.source}</td>
                            <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-1 text-xs font-semibold", JOB_STATUS_COLORS[job.status] ?? "bg-slate-100 text-slate-600")}>{job.status}</span></td>
                            <td className="px-3 py-2 text-right text-slate-600">USD {Number(job.actual_cost_usd ?? job.estimated_cost_usd ?? 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{job.leads_new ?? 0}/{job.leads_found ?? 0}</td>
                            <td className="px-3 py-2 text-xs text-slate-500">{job.linked_run_id ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">Sin batches todavía.</div>}
          </div>
        </SectionCard>

        <SectionCard title="Jobs legacy" description="Compatibilidad con jobs individuales existentes fuera del modelo de batch.">
          <div className="space-y-3">
            <SectionWarning message={sectionErrors.jobs} />
            {legacyJobs.length ? legacyJobs.map((job) => (
              <div key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{job.source}</p>
                      <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", JOB_STATUS_COLORS[job.status] ?? "bg-slate-100 text-slate-600")}>{job.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{job.location} · {job.niche ?? "sin niche"}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatDate(job.created_at)}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{job.leads_new ?? 0} nuevos</div>
                    <div>USD {Number(job.actual_cost_usd ?? job.estimated_cost_usd ?? 0).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">Sin jobs legacy visibles.</div>}
          </div>
        </SectionCard>
      </div>
    </AdminPageLayout>
  );
}
