import { PipelineScheduler } from "../../../../src/modules/pipeline/scheduler.js";
import { pushToSchedulerBuffer } from "./log-buffer.js";

type SchedulerStatus = "running" | "stopped" | "disabled";

let _scheduler: PipelineScheduler | null = null;
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

  const scheduler = initEmbeddedScheduler();
  await scheduler.start();
  _status = "running";
  _startedAt = Date.now();

  pushToSchedulerBuffer({ ts: new Date().toISOString(), level: "info", msg: "Core scheduler started (embedded mode)" });
}

export function stopEmbeddedScheduler(): void {
  if (!isSchedulerEmbedded()) throw new Error("EMBED_SCHEDULER is not enabled");
  if (!_scheduler) return;
  _scheduler.stop();
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
