"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkCreateDiscoveryJobs,
  createDiscoveryJobBatch,
  getDiscoveryRecommendations,
  getLeadDensity,
  getZoneLeads,
  listDiscoveryJobBatches,
  listDiscoveryJobs,
  listGeoZones,
  listNicheAliasGroups,
  patchDiscoveryJobBatch,
  type DiscoveryCoverageGap,
  type DiscoveryGeoZone,
  type DiscoveryJob,
  type DiscoveryJobBatch,
  type DiscoveryLeadDensityFilters,
  type NicheAliasGroup,
  type DiscoveryLeadDensityMeta,
  type DiscoveryMapDensityLocation,
  type DiscoveryMapViewportBounds,
  type DiscoveryRecommendationData,
  type ZoneLead,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  buildNicheSuggestionTooltip,
  DISCOVERY_COMPOSER_STORAGE_KEY,
  parseDiscoveryComposerDraft,
  type DiscoveryComposerDraft,
} from "@/lib/discovery-workspace";
import {
  buildPredictiveContext,
  buildRecommendationOrigin,
  freeTextToSelection,
  type DiscoveryLocationSelection,
} from "@/lib/discovery-location";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { SectionCard, StatCard } from "@/components/admin-shell";
import { CollapsibleSection } from "@/components/collapsible-section";
import { EnrichmentSection } from "@/components/operations/enrichment-section";
import { SocialEnrichSection } from "@/components/operations/social-enrich-section";
import { RefreshMasivoSection } from "@/components/operations/discovery-refresh-masivo";
import { DiscoveryComposerCard } from "@/components/operations/discovery-composer-card";
import { DiscoveryBulkCard } from "@/components/operations/discovery-bulk-card";
import { DiscoveryContextMap } from "@/components/discovery-context-map";
import { buildComposerGeoSelection, buildZoneLeadRequest } from "@/lib/location-density-map";


const SOURCES = ["yelu", "pedidosya", "mintur", "osm", "miem_dei", "google_places"] as const;
const PROFILES = ["A", "B", "C", "D"] as const;
const EMPTY_DENSITY_FILTERS: DiscoveryLeadDensityFilters = {
  prospect_score_gte: 0,
};
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

const EMPTY_COMPOSER: DiscoveryComposerDraft = {
  sources: ["yelu", "mintur"],
  location: "Montevideo",
  niche: "",
  max_results: "200",
  cpu_budget: "balanced",
  google_profile: "B",
  google_concurrency: "5",
  google_cost_cap_usd: "",
  enrich_after_discovery: true,
  geo_selection: undefined,
};

function buildSelectedLocationKeyFromComposer(composer: DiscoveryComposerDraft): string | null {
  const parentLocationKey = composer.geo_selection?.parent_location_keys?.[0];
  const gridLocationKey = composer.geo_selection?.grid_location_keys?.[0];
  if (!parentLocationKey || !gridLocationKey) return null;
  return `${parentLocationKey}::${gridLocationKey}`;
}

function estimateGoogleCost(maxResults: number): number {
  const safe = Math.max(1, maxResults);
  return Math.ceil(safe / 20) * 0.035 + safe * 0.025;
}


function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function SectionWarning({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>;
}


// Las CollapsibleSection no renderizan children cuando están cerradas: este ping se monta
// recién cuando el usuario abre (o tenía abierta) alguna sección, y activa el fetching.
// Evita que cada visita a /admin/operations dispare las ~7 llamadas de discovery en vano.
function ActivationPing({ onActive }: { onActive: () => void }) {
  useEffect(() => {
    onActive();
  }, [onActive]);
  return null;
}

export function DiscoveryOps() {
  const token = useAuthStore((state) => state.token);
  const [activated, setActivated] = useState(false);
  const activate = useCallback(() => setActivated(true), []);
  const [composer, setComposer] = useState<DiscoveryComposerDraft>(EMPTY_COMPOSER);
  const [composerHydrated, setComposerHydrated] = useState(false);
  const [recommendations, setRecommendations] = useState<DiscoveryRecommendationData | null>(null);
  const [density, setDensity] = useState<DiscoveryMapDensityLocation[]>([]);
  const [densityMeta, setDensityMeta] = useState<DiscoveryLeadDensityMeta | null>(null);
  const [mapViewport, setMapViewport] = useState<{ zoom?: number; bbox?: DiscoveryMapViewportBounds }>({});
  const [viewportLeads, setViewportLeads] = useState<ZoneLead[]>([]);
  const [densityFilters, setDensityFilters] = useState<DiscoveryLeadDensityFilters>(EMPTY_DENSITY_FILTERS);
  const [densityLoading, setDensityLoading] = useState(false);
  const [zoneOptions, setZoneOptions] = useState<DiscoveryGeoZone[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [zoneOptionsLoading, setZoneOptionsLoading] = useState(false);
  const [nicheGroups, setNicheGroups] = useState<NicheAliasGroup[]>([]);
  const [zoneOptionsError, setZoneOptionsError] = useState<string | null>(null);
  const [zoneLeads, setZoneLeads] = useState<ZoneLead[] | null>(null);
  const [zoneLeadsTotal, setZoneLeadsTotal] = useState(0);
  const [zoneLeadsLoading, setZoneLeadsLoading] = useState(false);
  const [zoneLeadsError, setZoneLeadsError] = useState<string | null>(null);
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
  const [composerSelection, setComposerSelection] = useState<DiscoveryLocationSelection | null>(null);
  const densityFiltersBootstrapped = useRef(false);

  const [bulkLocations, setBulkLocations] = useState<DiscoveryLocationSelection[]>([]);
  const [bulkNiches, setBulkNiches] = useState<string[]>([]);
  const [bulkMaxResults, setBulkMaxResults] = useState("100");
  const [bulkCostCap, setBulkCostCap] = useState("1");
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkConfirmPending, setBulkConfirmPending] = useState(false);

  const effectiveComposerLocation = composer.location.trim();
  const bulkEffectiveLocations = useMemo(
    () => bulkLocations.map((selection) => selection.display_name),
    [bulkLocations]
  );
  const bulkJobCount = bulkEffectiveLocations.length * bulkNiches.length;
  const bulkPerJobCost = estimateGoogleCost(Math.max(1, Number(bulkMaxResults) || 0));
  const bulkTotalCost = bulkJobCount * bulkPerJobCost;

  async function handleBulkCreate() {
    if (!token || bulkJobCount === 0) return;
    setBulkCreating(true);
    setBulkResult(null);
    setBulkError(null);
    setBulkConfirmPending(false);
    try {
      const jobs = bulkLocations.flatMap((selection) =>
        bulkNiches.map((niche) => ({
          source: "google_places" as const,
          location: selection.display_name,
          niche,
          max_results: Math.max(1, Number(bulkMaxResults) || 100),
          cost_cap_usd: Number(bulkCostCap) || undefined,
          predictive_context: buildPredictiveContext(selection),
        }))
      );
      const res = await bulkCreateDiscoveryJobs(token, jobs);
      setBulkResult(`${res.data.count} jobs creados · costo estimado USD ${res.data.total_estimated_cost_usd.toFixed(2)}`);
      await loadPage();
    } catch (err) {
      const apiErr = err instanceof Error && "status" in err ? (err as { status: number; error_code?: string }) : null;
      if (apiErr?.status === 409) {
        setBulkError("Ya hay un proceso en ejecución. Esperá a que termine antes de crear nuevos jobs.");
      } else if (apiErr?.status === 400 && (apiErr as { error_code?: string }).error_code === "budget_exceeded") {
        setBulkError("El costo estimado supera el presupuesto mensual disponible de Google Places. Reducí la cantidad de jobs.");
      } else {
        setBulkError("No se pudieron crear los jobs. Intentá de nuevo o reducí la cantidad de ubicaciones/nichos.");
      }
    } finally {
      setBulkCreating(false);
    }
  }

  function handleComposerReset() {
    setComposer(EMPTY_COMPOSER);
    setComposerSelection(EMPTY_COMPOSER.location.trim() ? freeTextToSelection(EMPTY_COMPOSER.location) : null);
    setSelectedLocationKey(null);
    setPrefillNote(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(DISCOVERY_COMPOSER_STORAGE_KEY);
  }

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
    if (!effectiveComposerLocation.trim()) warnings.push("La ubicación es obligatoria.");
    if (includesGoogle && !composer.google_cost_cap_usd.trim()) warnings.push("Google Places requiere cost cap USD antes de crear el lote.");
    if (includesGoogle && remainingBudget != null && remainingBudget <= 0) warnings.push("El presupuesto mensual de Google Places está agotado.");
    if (includesGoogle && remainingBudget != null && remainingBudget > 0 && estimatedGoogleCost > remainingBudget) warnings.push(`La estimación conservadora USD ${estimatedGoogleCost.toFixed(2)} supera el presupuesto restante USD ${remainingBudget.toFixed(2)}.`);
    if (includesGoogle && configuredCap > 0 && estimatedGoogleCost > configuredCap) warnings.push("La estimación conservadora supera el cap configurado para Google Places.");
    return warnings;
  }, [composer.google_cost_cap_usd, composer.sources.length, configuredCap, effectiveComposerLocation, estimatedGoogleCost, includesGoogle, remainingBudget]);

  async function loadDensity(filters: DiscoveryLeadDensityFilters, showSpinner = false) {
    if (!token) return;
    if (showSpinner) setDensityLoading(true);
    try {
      const response = await getLeadDensity(token, { ...filters, ...mapViewport, limit: 30 });
      setDensity(response.data.locations);
      setDensityMeta(response.data.meta);
      setViewportLeads(response.data.viewport_leads ?? []);
      setSectionErrors((current) => ({ ...current, density: null }));
      setSelectedLocationKey((current) => response.data.locations.some((location) => location.location_key === current) ? current : null);
    } catch (err) {
      setDensity([]);
      setDensityMeta(null);
      setViewportLeads([]);
      setSectionErrors((current) => ({ ...current, density: getErrorMessage(err, "No se pudo cargar el mapa de densidad.") }));
    } finally {
      if (showSpinner) setDensityLoading(false);
    }
  }

  async function loadPage() {
    if (!token) return;
    setLoading(true);
    const results = await Promise.allSettled([
      listDiscoveryJobBatches(token, { include_jobs: true, limit: 20 }),
      listDiscoveryJobs(token, { limit: 50 }),
      getDiscoveryRecommendations(token, { sources: composer.sources, location: composer.location || undefined, niche: composer.niche || undefined, limit: 20 }),
      getLeadDensity(token, { ...densityFilters, ...mapViewport, limit: 30 }),
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
      setDensityMeta(densityRes.value.data.meta);
      setViewportLeads(densityRes.value.data.viewport_leads ?? []);
      setSelectedLocationKey((current) => densityRes.value.data.locations.some((location) => location.location_key === current) ? current : null);
    } else {
      nextErrors.density = getErrorMessage(densityRes.reason, "No se pudo cargar el mapa de densidad.");
      setDensity([]);
      setDensityMeta(null);
    }

    setSectionErrors(nextErrors);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(DISCOVERY_COMPOSER_STORAGE_KEY);
    const draft = parseDiscoveryComposerDraft(saved, EMPTY_COMPOSER);
    setComposer(draft);
    setSelectedLocationKey(buildSelectedLocationKeyFromComposer(draft));
    setComposerSelection(draft.location.trim() ? freeTextToSelection(draft.location) : null);
    setComposerHydrated(true);
  }, []);

  useEffect(() => {
    if (!composerHydrated || typeof window === "undefined") return;
    window.localStorage.setItem(DISCOVERY_COMPOSER_STORAGE_KEY, JSON.stringify(composer));
  }, [composer, composerHydrated]);

  useEffect(() => {
    if (!activated) return;
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activated]);

  useEffect(() => {
    if (!token || !activated) return;
    if (!densityFiltersBootstrapped.current) {
      densityFiltersBootstrapped.current = true;
      return;
    }
    setDensityLoading(true);
    const timeout = window.setTimeout(() => {
      void loadDensity(densityFilters, true);
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      setDensityLoading(false);
    };
  }, [densityFilters, mapViewport, token, activated]);

  useEffect(() => {
    if (!token || !activated) return;
    void listNicheAliasGroups(token).then((response) => setNicheGroups(response.data)).catch(() => setNicheGroups([]));
  }, [token, activated]);

  useEffect(() => {
    if (!token || !activated) return;
    setZoneOptionsLoading(true);
    const timeout = window.setTimeout(() => {
      void listGeoZones(token, { q: zoneSearch || undefined, limit: 60 })
        .then((response) => {
          setZoneOptions(response.data);
          setZoneOptionsError(null);
        })
        .catch((err) => {
          setZoneOptions([]);
          setZoneOptionsError(getErrorMessage(err, "No se pudieron cargar las zonas."));
        })
        .finally(() => setZoneOptionsLoading(false));
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      setZoneOptionsLoading(false);
    };
  }, [token, zoneSearch, activated]);

  useEffect(() => {
    if (!token || !activated) return;
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
  }, [composer.location, composer.niche, composer.sources, token, activated]);

  async function handleCreateBatch() {
    if (!token) return;
    setError(null); // N98: un 409 viejo quedaba pegado sobre el create exitoso siguiente
    setCreating(true);
    try {
      await createDiscoveryJobBatch(token, {
        sources: composer.sources,
        location: effectiveComposerLocation.trim(),
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
        recommendation_origin: buildRecommendationOrigin(composerSelection, prefillNote),
        enrich_after_discovery: composer.enrich_after_discovery,
        predictive_context: composerSelection ? buildPredictiveContext(composerSelection) : undefined,
      });
      await loadPage();
    } catch (err) {
      const apiErr = err instanceof Error && "status" in err ? (err as { status: number; error_code?: string }) : null;
      if (apiErr?.status === 409) {
        setError("Ya hay un proceso en ejecución. Esperá a que termine antes de crear un nuevo batch.");
      } else {
        setError("No se pudo crear el batch. Verificá los parámetros e intentá de nuevo.");
      }
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
      geo_selection: undefined,
    }));
    setComposerSelection(freeTextToSelection(gap.location_label));
    setSelectedLocationKey(null);
    setPrefillNote(`Gap ${gap.location_label} · ${gap.niche}`);
  }

  function applyLocationPrefill(location: DiscoveryMapDensityLocation) {
    setComposer((current) => ({
      ...current,
      location: location.parent_location_label,
      geo_selection: buildComposerGeoSelection(location),
    }));
    setComposerSelection(freeTextToSelection(location.parent_location_label));
    setSelectedLocationKey(location.location_key);
    setPrefillNote(`Zona ${location.location_label}`);
  }

  const selectedLocation = useMemo(() => {
    return selectedLocationKey
      ? density.find((location) => location.location_key === selectedLocationKey) ?? null
      : null;
  }, [density, selectedLocationKey]);

  useEffect(() => {
    if (!token || !selectedLocation) {
      setZoneLeads(null);
      setZoneLeadsTotal(0);
      return;
    }

    setZoneLeads([]);
    setZoneLeadsTotal(0);
    setZoneLeadsLoading(true);
    void getZoneLeads(token, { ...buildZoneLeadRequest(selectedLocation), ...densityFilters })
      .then((res) => {
        setZoneLeads(res.data);
        setZoneLeadsTotal(res.total);
        setZoneLeadsError(null);
      })
      .catch((err) => {
        setZoneLeads([]);
        setZoneLeadsTotal(0);
        setZoneLeadsError(err instanceof Error ? err.message : "No se pudieron cargar los leads de la zona seleccionada.");
      })
      .finally(() => setZoneLeadsLoading(false));
  }, [densityFilters, selectedLocation, token]);

  function handleDrillDown(location: DiscoveryMapDensityLocation) {
    setSelectedLocationKey(location.location_key);
  }

  const densityNicheSuggestions = useMemo(() => {
    return Array.from(new Set((recommendations?.niche_suggestions ?? []).map((entry) => entry.niche).filter(Boolean))).sort((left, right) => left.localeCompare(right, "es"));
  }, [recommendations]);

  const allRecentJobs = useMemo(() => {
    const batchChildren: DiscoveryJob[] = batches.flatMap((batch) => batch.jobs ?? []);
    const byId = new Map<string, DiscoveryJob>();
    for (const job of batchChildren) byId.set(job.id, job);
    for (const job of legacyJobs) if (!byId.has(job.id)) byId.set(job.id, job);
    return Array.from(byId.values());
  }, [batches, legacyJobs]);

  const jobsToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allRecentJobs.filter((job) => job.created_at.slice(0, 10) === today).length;
  }, [allRecentJobs]);

  const backlog = useMemo(() => {
    return allRecentJobs.filter((job) => ["queued", "running", "paused"].includes(job.status)).length;
  }, [allRecentJobs]);

  return (
    <>
      <CollapsibleSection
        title="Generar Procesos"
        description="Lanzadores de trabajo: enrichment de colección y discovery (composer, creación masiva y refresh)."
        id="generate-processes"
        storageKey="ops-enrichment-open"
        defaultOpen={false}
        actions={<button onClick={() => void loadPage()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Actualizar</button>}
      >
        <div className="space-y-4">
      <ActivationPing onActive={activate} />
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <SectionCard title="Enrichment de colección" description="Lanzá enrichment sobre un subconjunto filtrado o toda la colección, con re-score encadenado opcional.">
        <EnrichmentSection />
      </SectionCard>

      <SectionCard title="Social-enrich (aislado)" description="Actividad y liveness de redes en un subproceso fuera de la API, gated por los caps de recursos.">
        <SocialEnrichSection />
      </SectionCard>

      <DiscoveryComposerCard
        token={token}
        composer={composer}
        setComposer={setComposer}
        composerSelection={composerSelection}
        setComposerSelection={setComposerSelection}
        setSelectedLocationKey={setSelectedLocationKey}
        prefillNote={prefillNote}
        setPrefillNote={setPrefillNote}
        includesGoogle={includesGoogle}
        estimatedGoogleCost={estimatedGoogleCost}
        estimatedBatchCost={estimatedBatchCost}
        effectiveGoogleCap={effectiveGoogleCap}
        effectiveComposerLocation={effectiveComposerLocation}
        budgetSpent={recommendations?.google_places_budget?.budget_spent ?? null}
        remainingBudget={remainingBudget}
        batchWarnings={batchWarnings}
        creating={creating}
        onCreateBatch={() => void handleCreateBatch()}
        onReset={handleComposerReset}
      />

      <DiscoveryBulkCard
        token={token}
        bulkLocations={bulkLocations}
        setBulkLocations={setBulkLocations}
        bulkNiches={bulkNiches}
        setBulkNiches={setBulkNiches}
        bulkMaxResults={bulkMaxResults}
        setBulkMaxResults={setBulkMaxResults}
        bulkCostCap={bulkCostCap}
        setBulkCostCap={setBulkCostCap}
        bulkJobCount={bulkJobCount}
        bulkLocationsCount={bulkEffectiveLocations.length}
        bulkTotalCost={bulkTotalCost}
        bulkConfirmPending={bulkConfirmPending}
        setBulkConfirmPending={setBulkConfirmPending}
        bulkResult={bulkResult}
        bulkError={bulkError}
        bulkCreating={bulkCreating}
        onBulkCreate={() => void handleBulkCreate()}
      />

      <RefreshMasivoSection />

        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Discovery · contexto y mapa"
        description="Densidad por zona, coverage gaps, recomendaciones y batches recientes."
        id="discovery-context"
        storageKey="ops-discovery-context-open"
        defaultOpen={false}
      >
        <div className="space-y-4">
      <ActivationPing onActive={activate} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jobs creados hoy" value={loading ? "..." : jobsToday} hint="Jobs hijos y standalone creados hoy" />
        <StatCard label="Backlog activo" value={loading ? "..." : backlog} hint="Queued, running o paused" tone="warn" />
        <StatCard label="Google Places mes" value={recommendations?.monthly_cost != null ? `USD ${recommendations.monthly_cost.toFixed(2)}` : "..."} hint="Costo estimado acumulado de runs completados" tone="info" />
        <StatCard label="Presupuesto restante" value={recommendations?.google_places_budget ? `USD ${recommendations.google_places_budget.budget_remaining.toFixed(2)}` : "..."} hint={recommendations?.google_places_budget?.over_alert ? "Debajo del umbral de alerta" : "Budget disponible para jobs pagos"} tone={recommendations?.google_places_budget?.over_alert ? "warn" : "good"} />
      </div>

      <SectionCard title="Contexto y mapa" description="La carga de contexto arranca acá: elegí una cuadrícula desde el mapa y eso baja al Composer como ubicación visible más filtro geográfico estructurado persistido.">
        <div className="space-y-4">
          <SectionWarning message={sectionErrors.density} />
          <DiscoveryContextMap
            locations={density}
            meta={densityMeta}
            loadError={sectionErrors.density}
            selectedLocationKey={selectedLocationKey}
            onSelect={applyLocationPrefill}
            onSelectWithDrill={handleDrillDown}
            filters={densityFilters}
            onFiltersChange={setDensityFilters}
            nicheSuggestions={densityNicheSuggestions}
            loading={densityLoading}
            zones={zoneOptions}
            zoneSearch={zoneSearch}
            onZoneSearchChange={setZoneSearch}
            zonesLoading={zoneOptionsLoading}
            zonesError={zoneOptionsError}
            zoneLeads={zoneLeads}
            viewportLeads={viewportLeads}
            onViewportChange={setMapViewport}
            zoneLeadsTotal={zoneLeadsTotal}
            zoneLeadsLoading={zoneLeadsLoading}
            zoneLeadsError={zoneLeadsError}
            nicheGroups={nicheGroups}
            allowIconEditing
          />
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
                  <button key={group.location_key} type="button" onClick={() => { setComposer((current) => ({ ...current, location: group.location_label, geo_selection: undefined })); setComposerSelection(freeTextToSelection(group.location_label)); setSelectedLocationKey(null); setPrefillNote(`Ubicación ${group.location_label}`); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-sky-200 hover:bg-sky-50/40">
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
                {recommendations?.niche_suggestions.length ? recommendations.niche_suggestions.map((entry) => {
                  const breakdown = buildNicheSuggestionTooltip(entry, recommendations.top_niches_by_source);
                  return (
                    <div key={entry.key} className="group relative">
                      <button type="button" title={breakdown ?? undefined} onClick={() => { setComposer((current) => ({ ...current, niche: entry.niche })); setPrefillNote(`Niche ${entry.niche}`); }} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-sky-200 hover:bg-sky-50">
                        {entry.niche}
                        <span className="ml-2 text-xs text-slate-400">{entry.origin === "top_by_source" ? entry.source : entry.count}</span>
                      </button>
                      {breakdown ? <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden min-w-52 rounded-2xl border border-slate-200 bg-slate-950 px-3 py-2 text-xs text-white shadow-xl group-hover:block">{breakdown}</div> : null}
                    </div>
                  );
                }) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">No hay sugerencias de niche disponibles.</div>}
              </div>
              <p className="mt-2 text-xs text-slate-500">Hover sobre el contador para ver el breakdown por fuente cuando haya señal suficiente.</p>
            </div>
          </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <SectionCard title="Batches recientes" description="La unidad principal es el lote. La experiencia principal deja afuera los jobs legacy salvo compatibilidad explícita.">
          <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
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
                    <p className="mt-1 text-xs text-slate-500">{batch.enrich_after_discovery ? "Modo: discovery + enrich" : "Modo: solo discovery"}</p>
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
                    <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Fuente</th>
                          <th className="px-3 py-2 text-left">Estado</th>
                          <th className="px-3 py-2 text-right">Costo</th>
                          <th className="px-3 py-2 text-right">Leads</th>
                          <th className="px-3 py-2 text-left">Run discovery</th>
                          <th className="px-3 py-2 text-left">Enrich</th>
                          <th className="px-3 py-2 text-left">Run enrich</th>
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
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {job.enrich_after_discovery
                                ? <span title={job.enrich_error_message ?? undefined}>{job.enrich_status ?? "queued"}</span>
                                : "solo discovery"}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">{job.linked_enrich_run_id ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">Sin batches todavía.</div>}
          </div>
        </SectionCard>

        <SectionCard title="Compatibilidad legacy" description="Los jobs sin batch salen de la experiencia principal y quedan solo como referencia transitoria.">
          <div className="space-y-3">
            <SectionWarning message={sectionErrors.jobs} />
            {legacyJobs.length ? (
              <details className="rounded-2xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">Ver jobs legacy</summary>
                <div className="mt-4 space-y-3">
                  {legacyJobs.map((job) => (
                    <div key={job.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                  ))}
                </div>
              </details>
            ) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">Sin jobs legacy visibles.</div>}
          </div>
        </SectionCard>
      </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
