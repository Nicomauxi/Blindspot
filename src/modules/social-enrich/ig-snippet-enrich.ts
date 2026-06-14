// Runner del enriquecimiento de IG vía snippet de buscador (métricas + liveness, gratis).
// Itera los leads con IG seleccionada y consulta una cadena de proveedores (por defecto
// SearXNG self-hosted, resiliente al anti-bot). Fusiona vía buildSocialFusion.
//
// Selección inteligente (no gastar esfuerzo en casos irrelevantes):
//  - solo leads passed_filter con una URL de PERFIL de IG válida,
//  - salta los ya resueltos (social_enrich_status ok / no_data) salvo retryNoData,
//  - prioriza por prospect_score desc (los mejores leads primero, por si hay límite/cuota).
// Marca cada miss como "no_data" para no re-consultarlo en la próxima corrida.
// Aborta solo si el proveedor parece CAÍDO (racha de nulls SIN ningún éxito): con SearXNG
// un null suele ser una cuenta personal (sin métricas públicas), no un bloqueo.
import pLimit from "p-limit";
import { getLogger } from "../../shared/logger.js";
import type { Lead } from "../../shared/types.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadSocialSearch,
  updateLeadSocialEnrichStatus,
} from "../../storage/leads.js";
import { buildSocialFusion, extractUsernameFromUrl } from "./social-fusion.js";
import { defaultIgLookupChain, type IgLookup } from "./ig-lookup-chain.js";

const DEFAULT_THROTTLE_MS = 1500;
// Si los primeros N lookups son TODOS null y aún no hubo NINGÚN éxito, el proveedor está
// caído/bloqueado de entrada → abortar para no iterar en vano. Con ≥1 éxito, los nulls
// posteriores son cuentas personales (normal) y NO abortan.
const PROVIDER_DOWN_STREAK = 8;

export interface IgSnippetStats {
  loaded: number;
  selected: number;
  skipped_resolved: number;
  enriched: number;
  no_snippet: number;
  skipped_no_url: number;
  aborted_provider_down: boolean;
  /** Instrumentación de throughput (F1). */
  elapsed_ms: number;
  leads_per_sec: number;
}

export interface IgSnippetOptions {
  all?: boolean;
  run?: string;
  limit?: number;
  throttleMs?: number;
  nowIso?: string;
  retryNoData?: boolean; // re-consultar los marcados no_data (cuentas que antes no dieron métricas)
  lookup?: IgLookup; // inyectable para test / proveedor custom
  concurrency?: number; // F1: workers en paralelo (SearXNG aguanta; default 1 = legacy)
}

function instagramUrlOf(lead: Lead): string | null {
  const selected = lead.digital_footprint?.heuristic_discovery?.selected;
  const candidate = selected?.instagram as { url?: string } | null | undefined;
  return candidate?.url ?? null;
}

function statusOf(lead: Lead): "ok" | "blocked" | "no_data" | undefined {
  return lead.digital_footprint?.social_enrich_status;
}

// ¿El lead tiene MÉTRICAS sociales reales (no solo una URL)? Las corridas viejas (era
// login-wall) marcaban "ok" con social_activity pero sin followers (audience_tier null,
// active_platforms vacío). Esos NO cuentan como resueltos: SearXNG sí puede enriquecerlos.
function hasRealSocialMetrics(lead: Lead): boolean {
  const sa = lead.digital_footprint?.social_activity;
  if (!sa) return false;
  if (sa.summary?.audience_tier != null) return true;
  if (Array.isArray(sa.summary?.active_platforms) && sa.summary.active_platforms.length > 0) return true;
  const profiles = sa.profiles ?? {};
  return Object.values(profiles).some(
    (p) => (typeof p?.followers === "number" && p.followers > 0) || (typeof p?.likes === "number" && p.likes > 0)
  );
}

// Un lead está "resuelto" si ya tiene métricas reales (ok CON datos) o si lo consultamos
// por la vía nueva y no había métricas (no_data). Un "ok" vacío de la era vieja NO está
// resuelto → se re-consulta con SearXNG. Los no_data se re-incluyen solo con retryNoData.
function isResolved(lead: Lead, retryNoData: boolean): boolean {
  const status = statusOf(lead);
  if (status === "ok") return hasRealSocialMetrics(lead);
  if (status === "no_data") return !retryNoData;
  return false;
}

export async function runIgSnippetEnrich(opts: IgSnippetOptions): Promise<IgSnippetStats> {
  const log = getLogger();
  const lookup = opts.lookup ?? defaultIgLookupChain();
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const retryNoData = opts.retryNoData ?? false;

  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const eligible = loaded.filter((l) => l.passed_filter && instagramUrlOf(l) !== null);
  const resolved = eligible.filter((l) => isResolved(l, retryNoData));
  const candidates = eligible
    .filter((l) => !isResolved(l, retryNoData))
    // Priorizar por prospect_score desc: gastar el esfuerzo en los mejores leads primero.
    .sort((a, b) => (b.prospect_score ?? -1) - (a.prospect_score ?? -1))
    .slice(0, opts.limit ?? eligible.length);

  const stats: IgSnippetStats = {
    loaded: loaded.length,
    selected: candidates.length,
    skipped_resolved: resolved.length,
    enriched: 0,
    no_snippet: 0,
    skipped_no_url: 0,
    aborted_provider_down: false,
    elapsed_ms: 0,
    leads_per_sec: 0,
  };

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const limit = pLimit(concurrency);
  const startedAt = Date.now();
  // Provider-down: detecta SearXNG caído/bloqueado de entrada (muchos null sin NINGÚN
  // éxito). Con concurrencia, un lote inicial de cuentas-personales (null legítimo) NO
  // debe disparar un falso positivo → el umbral escala con la concurrencia. En runs
  // --retry-no-data los misses son ESPERADOS (ya eran no_data) → no aplica el abort.
  const downThreshold = retryNoData ? Infinity : Math.max(PROVIDER_DOWN_STREAK, concurrency * 4);
  let aborted = false;
  let processedNoSuccess = 0;

  async function processLead(lead: Lead): Promise<void> {
    if (aborted) return;
    const igUrl = instagramUrlOf(lead);
    const username = extractUsernameFromUrl(igUrl);
    if (!username || !igUrl) {
      stats.skipped_no_url += 1;
      return;
    }

    const profile = await lookup(username, { throttleMs });
    if (!profile) {
      stats.no_snippet += 1;
      await updateLeadSocialEnrichStatus(lead.id, "no_data").catch((err) => getLogger().warn({ leadId: lead.id, err: String(err) }, "social_enrich_status no_data no persistido — el lead se re-consultará"));
      if (stats.enriched === 0) {
        processedNoSuccess += 1;
        if (processedNoSuccess >= downThreshold && !aborted) {
          aborted = true;
          stats.aborted_provider_down = true;
          log.warn({ processedNoSuccess, downThreshold }, "IG snippet enrich: proveedor parece caído (nulls sin éxito) — abortando run");
        }
      }
      return;
    }

    const hasWebsite =
      Boolean(lead.website) || Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
    const fusion = await buildSocialFusion(lead, igUrl, profile, { ranAt: nowIso, nowIso, hasWebsite, allowLlm: false });
    await updateLeadSocialSearch(lead.id, fusion.socialSearch, fusion.tags, null, fusion.socialActivity, fusion.socialCanonical);
    await updateLeadSocialEnrichStatus(lead.id, "ok").catch((err) => getLogger().warn({ leadId: lead.id, err: String(err) }, "social_enrich_status ok no persistido — el lead se re-consultará"));
    stats.enriched += 1;
  }

  await Promise.all(candidates.map((lead) => limit(() => processLead(lead))));

  stats.elapsed_ms = Date.now() - startedAt;
  const done = stats.enriched + stats.no_snippet;
  stats.leads_per_sec = stats.elapsed_ms > 0 ? Number((done / (stats.elapsed_ms / 1000)).toFixed(2)) : 0;

  log.info(stats, "IG snippet enrich complete");
  return stats;
}
