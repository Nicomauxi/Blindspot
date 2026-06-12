import { processDueCrmReminders } from "../crm/reminder-alerts.js";
import os from "node:os";
import cron from "node-cron";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";
import { executeRun, transitionToPending } from "./run-executor.js";
import { processQueuedDiscoveryJobs } from "./discovery-jobs.js";
import { nextCronRun } from "./scheduled-for.js";
import { discoveryJobConcurrencyFromCpuBudget } from "../../shared/ram.js";
import type { PipelineRun, PipelineConfig, CpuBudget } from "./types.js";

const logger = getLogger();

const PIPELINE_POLL_INTERVAL_MS = 60_000;

// Caps configurables en pipeline_config (ver Variables · Operaciones).
type ResourceCaps = { max_concurrent_runs?: number; max_cpu_pct?: number; max_ram_pct?: number };
const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_CPU_PCT = 80;
const DEFAULT_MAX_RAM_PCT = 80;

function resolveDiscoveryConcurrency(config: (PipelineConfig & { updated_at?: string }) | null): number {
  if (!config) return 1;
  const maxJobs = (config.phases?.discovery as { max_jobs?: number } | undefined)?.max_jobs;
  if (typeof maxJobs === "number" && maxJobs > 0) return maxJobs;
  const cpuBudget = config.cpu_budget as CpuBudget | undefined;
  return cpuBudget ? discoveryJobConcurrencyFromCpuBudget(cpuBudget) : 1;
}

export function resolveMaxConcurrentRuns(config: (PipelineConfig & ResourceCaps) | null): number {
  const v = (config as ResourceCaps | null)?.max_concurrent_runs;
  return typeof v === "number" && v > 0 ? v : DEFAULT_MAX_CONCURRENT_RUNS;
}

// Uso instantáneo del host (mismo cálculo que el monitor de recursos de la API).
function hostResourceUsage(): { cpuPct: number; ramPct: number } {
  const total = os.totalmem();
  const free = os.freemem();
  const ramPct = total > 0 ? ((total - free) / total) * 100 : 0;
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const cpuPct = Math.min(100, (load1 / cores) * 100);
  return { cpuPct, ramPct };
}
const CONFIG_WATCH_INTERVAL_MS = 60_000;
const DISCOVERY_POLL_INTERVAL_MS = 30_000;
// N27: chequeo de reminders CRM vencidos → system_alerts al owner.
const CRM_REMINDER_POLL_INTERVAL_MS = 5 * 60_000;

export class PipelineScheduler {
  private cronTask: ReturnType<typeof cron.schedule> | null = null;
  private pipelinePollTimer: ReturnType<typeof setInterval> | null = null;
  private configWatchTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryPollTimer: ReturnType<typeof setInterval> | null = null;
  private crmReminderTimer: ReturnType<typeof setInterval> | null = null;
  private activeRunIds = new Set<string>();
  private lastConfigUpdatedAt: string | null = null;
  private polling = false;

  async start(): Promise<void> {
    logger.info("Pipeline scheduler starting");

    await this.loadConfigAndStartCron();

    this.pipelinePollTimer = setInterval(() => {
      this.pollPendingRuns().catch((err) =>
        logger.error({ err }, "Pipeline poll error")
      );
    }, PIPELINE_POLL_INTERVAL_MS);

    this.configWatchTimer = setInterval(() => {
      this.watchConfig().catch((err) =>
        logger.error({ err }, "Config watch error")
      );
    }, CONFIG_WATCH_INTERVAL_MS);

    this.discoveryPollTimer = setInterval(() => {
      this.pollDiscoveryJobs().catch((err) =>
        logger.error({ err }, "Discovery poll error")
      );
    }, DISCOVERY_POLL_INTERVAL_MS);

    // N27: reminders CRM → alertas (best-effort, nunca tumba el scheduler).
    this.crmReminderTimer = setInterval(() => {
      processDueCrmReminders().catch((err) =>
        logger.error({ err }, "CRM reminder poll error")
      );
    }, CRM_REMINDER_POLL_INTERVAL_MS);

    // Initial checks on startup
    await this.pollPendingRuns();

    logger.info("Pipeline scheduler started");
  }

  stop(): void {
    this.cronTask?.stop();
    if (this.pipelinePollTimer) clearInterval(this.pipelinePollTimer);
    if (this.configWatchTimer) clearInterval(this.configWatchTimer);
    if (this.discoveryPollTimer) clearInterval(this.discoveryPollTimer);
    if (this.crmReminderTimer) clearInterval(this.crmReminderTimer);
    logger.info("Pipeline scheduler stopped");
  }

  async handleNotify(runId?: string): Promise<void> {
    logger.debug({ runId }, "pg_notify received — checking pending runs");
    await this.pollPendingRuns(runId);
  }

  private async loadConfigAndStartCron(): Promise<void> {
    const config = await this.fetchConfig();
    if (!config) return;

    this.lastConfigUpdatedAt = config.updated_at ?? null;
    if (await this.isRestoreMaintenanceMode()) {
      logger.info("Backup restore maintenance mode active — pipeline cron start deferred");
      return;
    }

    if (config.enabled && config.cron_expression) {
      this.scheduleCron(config.cron_expression);
    }
  }

  private scheduleCron(expression: string): void {
    this.cronTask?.stop();

    if (!cron.validate(expression)) {
      logger.warn({ expression }, "Invalid cron expression — cron disabled");
      return;
    }

    this.cronTask = cron.schedule(expression, async () => {
      if (await this.isRestoreMaintenanceMode()) {
        logger.info("Backup restore maintenance mode active — cron tick skipped");
        return;
      }

      logger.info("Cron tick: queuing scheduled run");
      try {
        const runId = await transitionToPending("cron");
        // Route through pollPendingRuns to reuse the single-instance polling
        // guard and the atomic DB claim, avoiding double-execution when both
        // the cron tick and the regular poll race.
        await this.pollPendingRuns(runId);
        await this.updateScheduledFor(expression);
      } catch (err) {
        logger.error({ err }, "Cron-triggered run failed");
      }
    });

    logger.info({ expression }, "Cron scheduled");
  }

  private async watchConfig(): Promise<void> {
    const config = await this.fetchConfig();
    if (!config) return;

    const updatedAt = config.updated_at ?? null;
    if (updatedAt === this.lastConfigUpdatedAt) return;

    logger.info({ updatedAt }, "Pipeline config changed — reloading cron");
    this.lastConfigUpdatedAt = updatedAt;

    if (config.enabled && config.cron_expression) {
      this.scheduleCron(config.cron_expression);
    } else {
      this.cronTask?.stop();
      this.cronTask = null;
    }
  }

  private async pollPendingRuns(specificRunId?: string): Promise<void> {
    if (this.polling) {
      logger.debug("Poll already in progress — skipping concurrent poll");
      return;
    }
    this.polling = true;
    try {
      await this._pollPendingRunsImpl(specificRunId);
    } finally {
      this.polling = false;
    }
  }

  private async _pollPendingRunsImpl(specificRunId?: string): Promise<void> {
    if (await this.isRestoreMaintenanceMode()) {
      logger.info("Backup restore maintenance mode active — pending run poll skipped");
      return;
    }

    const config = await this.fetchConfig();
    const maxConcurrent = resolveMaxConcurrentRuns(config);

    const slots = maxConcurrent - this.activeRunIds.size;
    if (slots <= 0) {
      logger.debug({ active: this.activeRunIds.size, maxConcurrent }, "All run slots busy — skipping poll");
      return;
    }

    // Guarda de recursos: sólo aplica a runs *adicionales*. El primer run nunca
    // se bloquea por recursos para no detener todo el trabajo del pipeline.
    if (this.activeRunIds.size > 0 && !this.resourcesAllowNewRun(config)) {
      return;
    }

    const supabase = getSupabase();
    let query = supabase
      .from("pipeline_runs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(slots);

    if (specificRunId) {
      query = supabase
        .from("pipeline_runs")
        .select("*")
        .eq("id", specificRunId)
        .eq("status", "pending")
        .limit(1);
    }

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, "Failed to poll pending runs");
      return;
    }

    if (!data || data.length === 0) return;

    for (const row of data as PipelineRun[]) {
      if (this.activeRunIds.has(row.id)) continue;
      // Reservamos el slot de forma síncrona ANTES de despachar, así el próximo
      // poll cuenta correctamente los slots ocupados aunque el run aún no haya
      // hecho el claim atómico en DB (evita reintentos redundantes con cap > 1).
      this.activeRunIds.add(row.id);
      logger.info({ runId: row.id, triggeredBy: row.triggered_by }, "Picked up pending run");
      // Fire-and-forget: cuando maxConcurrent > 1 los runs corren en paralelo.
      // Con el default (1), sólo se lanza un run por vez (mismo comportamiento previo).
      void this.executePendingRun(row.id).catch((err) =>
        logger.error({ err, runId: row.id }, "Pending run execution failed")
      );
    }
  }

  private resourcesAllowNewRun(config: (PipelineConfig & ResourceCaps) | null): boolean {
    const caps = config as ResourceCaps | null;
    const maxCpu = caps?.max_cpu_pct ?? DEFAULT_MAX_CPU_PCT;
    const maxRam = caps?.max_ram_pct ?? DEFAULT_MAX_RAM_PCT;
    const { cpuPct, ramPct } = hostResourceUsage();
    if (cpuPct > maxCpu || ramPct > maxRam) {
      logger.info(
        { cpuPct: Math.round(cpuPct), ramPct: Math.round(ramPct), maxCpu, maxRam },
        "Host resources above caps — deferring additional run"
      );
      return false;
    }
    return true;
  }

  private async pollDiscoveryJobs(): Promise<void> {
    try {
      const config = await this.fetchConfig();
      const concurrency = resolveDiscoveryConcurrency(config);
      const summary = await processQueuedDiscoveryJobs(concurrency);
      if (summary.jobs_processed > 0) {
        logger.info({ ...summary, concurrency }, "Discovery jobs processed");
      }
    } catch (err) {
      logger.error({ err }, "Discovery jobs poll error");
    }
  }

  // El slot (activeRunIds) ya fue reservado por el poller antes de llamar acá;
  // este método libera el slot en TODA salida (claim fallido o run completado).
  private async executePendingRun(runId: string): Promise<void> {
    const supabase = getSupabase();
    this.activeRunIds.add(runId); // idempotente: garantiza el tracking incluso si se invoca directo

    try {
      // Atomic claim via UPDATE-RETURNING: only one worker can transition
      // pending → running. Prevents two scheduler instances from executing the
      // same run when running multi-instance.
      const { data: claimed, error: claimError } = await supabase
        .from("pipeline_runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "pending")
        .select("*")
        .single();

      if (claimError) {
        // PGRST116 = no rows returned (another worker took it, or it's not pending).
        if (claimError.code === "PGRST116") {
          logger.debug({ runId }, "Run already claimed by another worker — skipping");
          return;
        }
        logger.error({ runId, error: claimError }, "Failed to claim pending run");
        return;
      }

      if (!claimed) {
        logger.debug({ runId }, "Run already claimed by another worker — skipping");
        return;
      }

      const run = claimed as PipelineRun;
      const config = await this.fetchConfig();
      const runWithConfig: PipelineRun = { ...run, config_snapshot: config };

      await executeRun(runWithConfig);
    } finally {
      this.activeRunIds.delete(runId);
    }
  }

  private async fetchConfig(): Promise<(PipelineConfig & { updated_at?: string }) | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("pipeline_config")
      .select("*")
      .eq("id", "singleton")
      .single();

    if (error) {
      logger.warn({ error }, "Failed to fetch pipeline config");
      return null;
    }

    return data as PipelineConfig & { updated_at?: string };
  }


  private async isRestoreMaintenanceMode(): Promise<boolean> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("backup_config")
        .select("maintenance_mode")
        .eq("id", "singleton")
        .maybeSingle();

      if (error) {
        logger.warn({ error }, "Failed to fetch backup maintenance mode");
        return false;
      }

      return Boolean((data as { maintenance_mode?: boolean } | null)?.maintenance_mode);
    } catch (error) {
      logger.debug({ error }, "Restore maintenance mode unavailable; continuing without backup maintenance lock");
      return false;
    }
  }

  private async updateScheduledFor(expression: string): Promise<void> {
    const supabase = getSupabase();
    const nextRun = nextCronRun(expression);
    await supabase
      .from("pipeline_config")
      .update({
        last_completed_at: new Date().toISOString(),
        scheduled_for: nextRun.toISOString(),
      })
      .eq("id", "singleton");
    logger.info({ nextRun }, "scheduled_for updated");
  }
}
