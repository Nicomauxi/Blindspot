import { PipelineScheduler } from "../../../../src/modules/pipeline/scheduler.js";
import { PgListener } from "../../../../src/modules/pipeline/pg-listener.js";
import { recoverOrphanedRuns } from "../../../../src/modules/pipeline/crash-recovery.js";
import { pushToSchedulerBuffer } from "./log-buffer.js";

type SchedulerStatus = "running" | "stopped" | "disabled";

let _scheduler: PipelineScheduler | null = null;
let _listener: PgListener | null = null;
let _status: SchedulerStatus = "disabled";
let _startedAt: number | null = null;

export function isSchedulerEmbedded(): boolean {
  return process.env["EMBED_SCHEDULER"] === "true";
}

export function getEmbeddedScheduler(): PipelineScheduler | null {
  return _scheduler;
}

export function getSchedulerStatus(): SchedulerStatus {
  if (!isSchedulerEmbedded()) return "disabled";
  return _status;
}

export function getSchedulerUptimeSeconds(): number | null {
  if (_startedAt === null) return null;
  return Math.round((Date.now() - _startedAt) / 1000);
}

export function initEmbeddedScheduler(): PipelineScheduler {
  if (!_scheduler) _scheduler = new PipelineScheduler();
  return _scheduler;
}

export async function startEmbeddedScheduler(): Promise<void> {
  if (!isSchedulerEmbedded()) throw new Error("EMBED_SCHEDULER is not enabled");
  if (_status === "running") return; // Already running — idempotent

  // N39: la topología real (EMBED_SCHEDULER=true) nunca corría crash recovery — un
  // crash mid-run dejaba el run 'running' zombie y POST /pipeline/run devolvía 409
  // para siempre. Mismo recovery que el core standalone (con umbral de edad).
  try {
    const recovered = await recoverOrphanedRuns();
    if (recovered > 0) {
      pushToSchedulerBuffer({
        ts: new Date().toISOString(),
        level: "warn",
        msg: `Crash recovery: ${recovered} run(s) huérfanos abortados`,
      });
    }
  } catch (err) {
    pushToSchedulerBuffer({
      ts: new Date().toISOString(),
      level: "error",
      msg: `Crash recovery falló: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const scheduler = initEmbeddedScheduler();
  await scheduler.start();

  // N44: en modo embebido el PgListener no se instanciaba — el pg_notify de
  // POST /pipeline/run no tenía oyente y el run esperaba al poll de 60s.
  const databaseUrl = process.env["DATABASE_URL"];
  if (!_listener && databaseUrl) {
    try {
      _listener = new PgListener(databaseUrl, (runId) => scheduler.handleNotify(runId));
      await _listener.start();
    } catch (err) {
      _listener = null;
      pushToSchedulerBuffer({
        ts: new Date().toISOString(),
        level: "warn",
        msg: `PgListener no arrancó (${err instanceof Error ? err.message : String(err)}) — fallback a polling`,
      });
    }
  }
  _status = "running";
  _startedAt = Date.now();

  pushToSchedulerBuffer({ ts: new Date().toISOString(), level: "info", msg: "Core scheduler started (embedded mode)" });
}

export function stopEmbeddedScheduler(): void {
  if (!isSchedulerEmbedded()) throw new Error("EMBED_SCHEDULER is not enabled");
  if (!_scheduler) return;
  _scheduler.stop();
  if (_listener) {
    _listener.stop();
    _listener = null;
  }
  _status = "stopped";
  _startedAt = null;
  pushToSchedulerBuffer({ ts: new Date().toISOString(), level: "warn", msg: "Core scheduler stopped" });
}

export async function restartEmbeddedScheduler(): Promise<void> {
  pushToSchedulerBuffer({ ts: new Date().toISOString(), level: "info", msg: "Restarting core scheduler…" });
  stopEmbeddedScheduler();
  // Brief pause so the scheduler's internal timers flush before re-init.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  _scheduler = null; // Force fresh instance on restart
  await startEmbeddedScheduler();
}
