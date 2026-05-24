import { execFile } from "node:child_process";
import { getDb } from "../../db/client.js";

type Pm2Process = {
  name?: string;
  pm2_env?: { pm_uptime?: number };
  monit?: { cpu?: number; memory?: number };
};

type MetricRow = {
  process: string;
  cpu_pct: number | null;
  mem_bytes: number | null;
  uptime_seconds: number;
  recorded_at: string;
};

let intervalId: NodeJS.Timeout | null = null;
let lastCpuUsage = process.cpuUsage();
let lastSampleMs = Date.now();

function sampledCpuPct(): number {
  const now = Date.now();
  const elapsed = now - lastSampleMs;
  const delta = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastSampleMs = now;
  if (elapsed <= 0) return 0;
  const cpuMs = (delta.user + delta.system) / 1000;
  return Math.min(Math.round((cpuMs / elapsed) * 1000) / 10, 100);
}

async function listPm2(): Promise<Pm2Process[]> {
  return new Promise((resolve) => {
    execFile("pm2", ["jlist"], { timeout: 5_000 }, (error, stdout) => {
      if (error) { resolve([]); return; }
      try {
        const parsed = JSON.parse(stdout) as unknown;
        resolve(Array.isArray(parsed) ? (parsed as Pm2Process[]) : []);
      } catch { resolve([]); }
    });
  });
}

async function recordSnapshot(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const mem = process.memoryUsage();
  const rows: MetricRow[] = [
    {
      process: "api",
      cpu_pct: sampledCpuPct(),
      mem_bytes: mem.rss,
      uptime_seconds: Math.round(process.uptime()),
      recorded_at: now,
    },
  ];

  if (process.env["NODE_ENV"] === "production") {
    const pm2List = await listPm2();
    for (const entry of pm2List) {
      if (!entry.name || entry.name === "blindspot-api") continue;
      const name = entry.name.replace(/^blindspot-/, "");
      const pmUptime = entry.pm2_env?.pm_uptime;
      rows.push({
        process: name,
        cpu_pct: typeof entry.monit?.cpu === "number" ? entry.monit.cpu : null,
        mem_bytes: typeof entry.monit?.memory === "number" ? entry.monit.memory : null,
        uptime_seconds: typeof pmUptime === "number" ? Math.max(Math.round((Date.now() - pmUptime) / 1000), 0) : 0,
        recorded_at: now,
      });
    }
  }

  const { error } = await db.from("process_metrics").insert(rows);
  if (error) return;

  // Purge records older than 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.from("process_metrics").delete().lt("recorded_at", cutoff);
}

export function startProcessMetricsRecorder(): void {
  void recordSnapshot();
  intervalId = setInterval(() => void recordSnapshot(), 30_000);
}

export function stopProcessMetricsRecorder(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
