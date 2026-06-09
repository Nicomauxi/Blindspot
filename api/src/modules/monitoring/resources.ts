import os from "node:os";
import { promisify } from "node:util";

// `exec` se resuelve de forma diferida (dynamic import) para no acceder al
// binding al cargar el módulo: así los tests que mockean node:child_process sin
// `exec` no rompen al importar las rutas de monitoreo.
async function runShell(command: string, timeout: number): Promise<string> {
  const { exec } = await import("node:child_process");
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(command, { timeout });
  return stdout;
}

export interface ResourceSnapshot {
  ram: { used_bytes: number; free_bytes: number; total_bytes: number; pct: number };
  disk: { used_bytes: number; free_bytes: number; total_bytes: number; pct: number } | null;
  cpu: { load_1m: number; cores: number; pct: number };
  processes: Array<{ pid: number; cmd: string; cpu_pct: number; mem_mb: number }>;
  sampled_at: string;
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

// Disco del filesystem del proyecto vía `df -kP`.
async function readDisk(): Promise<ResourceSnapshot["disk"]> {
  try {
    const stdout = await runShell("df -kP .", 4000);
    const line = stdout.trim().split("\n").at(-1) ?? "";
    const cols = line.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const total = Number(cols[1]) * 1024;
    const used = Number(cols[2]) * 1024;
    const free = Number(cols[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0) return null;
    return { used_bytes: used, free_bytes: free, total_bytes: total, pct: pct(used, total) };
  } catch {
    return null;
  }
}

// Top procesos por memoria (node/core/api) vía `ps`.
async function readProcesses(): Promise<ResourceSnapshot["processes"]> {
  try {
    const stdout = await runShell("ps -eo pid,pcpu,rss,comm --sort=-rss | head -n 12", 4000);
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length >= 4)
      .map((c) => ({
        pid: Number(c[0]),
        cpu_pct: Number(c[1]),
        mem_mb: Math.round(Number(c[2]) / 1024),
        cmd: c.slice(3).join(" "),
      }))
      .filter((p) => Number.isFinite(p.pid));
  } catch {
    return [];
  }
}

export async function buildResourceSnapshot(): Promise<ResourceSnapshot> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const [disk, processes] = await Promise.all([readDisk(), readProcesses()]);
  return {
    ram: { used_bytes: used, free_bytes: free, total_bytes: total, pct: pct(used, total) },
    disk,
    cpu: { load_1m: Math.round(load1 * 100) / 100, cores, pct: Math.min(100, Math.round((load1 / cores) * 1000) / 10) },
    processes,
    sampled_at: new Date().toISOString(),
  };
}
