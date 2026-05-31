"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  getProcessMetrics,
  getSchedulerStatus,
  getSchedulerLogs,
  getApiLogs,
  startScheduler,
  restartScheduler,
  type ProcessMetricSnapshot,
  type ProcessMetricsData,
  type SchedulerStatusData,
  type SchedulerLogLine,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const POLL_METRICS_MS = 3_000;
const POLL_LOGS_MS = 2_000;

const PROCESS_COLORS: Record<string, string> = {
  api: "#0ea5e9",
  core: "#8b5cf6",
  ui: "#10b981",
};

type ProcessKey = "api" | "core";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMem(bytes: number | null): string {
  if (bytes === null) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function logLevelColor(level: string): string {
  if (level === "error") return "text-rose-400";
  if (level === "warn") return "text-amber-400";
  return "text-slate-300";
}

// ── Terminal log panel ────────────────────────────────────────────────────────

function TerminalPanel({
  lines,
  loading,
  placeholder,
  onClear,
}: {
  lines: SchedulerLogLine[];
  loading: boolean;
  placeholder: string;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950 flex flex-col" style={{ height: 300 }}>
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <span className="text-[10px] font-mono font-medium uppercase tracking-widest text-slate-500">
          logs
        </span>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-[10px] text-slate-600 animate-pulse">actualizando…</span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="rounded px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            Limpiar
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {lines.length === 0 ? (
          <p className="text-xs font-mono text-slate-600 mt-2">{placeholder}</p>
        ) : (
          lines.map((line, idx) => (
            <p key={idx} className="text-xs font-mono leading-5 whitespace-pre-wrap break-all">
              <span className="text-slate-600 select-none mr-2">
                {formatTime(line.ts)}
              </span>
              <span className={logLevelColor(line.level)}>
                {line.msg}
              </span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}

// ── Process control card ──────────────────────────────────────────────────────

function ProcessControlCard({
  processKey,
  metrics,
  schedulerStatus,
  isSelected,
  onSelect,
  onStart,
  onRestart,
  actionLoading,
}: {
  processKey: ProcessKey;
  metrics: ProcessMetricSnapshot | null;
  schedulerStatus: SchedulerStatusData | null;
  isSelected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onRestart: () => void;
  actionLoading: boolean;
}) {
  const color = PROCESS_COLORS[processKey] ?? "#64748b";

  const status = processKey === "core"
    ? schedulerStatus?.status ?? "disabled"
    : "running"; // API is always running if we can reach it

  const statusLabel =
    status === "running" ? "Corriendo" :
    status === "stopped" ? "Detenido" :
    "No embebido";

  const statusDot =
    status === "running" ? "bg-emerald-500" :
    status === "stopped" ? "bg-rose-500" :
    "bg-slate-400";

  const uptimeSeconds = processKey === "core"
    ? schedulerStatus?.uptime_seconds ?? metrics?.uptime_seconds ?? null
    : metrics?.uptime_seconds ?? null;

  const canControl = processKey === "core" && schedulerStatus?.embedded === true;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border px-4 py-3 text-left transition-colors",
        isSelected
          ? "border-slate-600 bg-slate-900 ring-1 ring-slate-700"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: name + status */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0">
            <p className={cn("text-sm font-semibold", isSelected ? "text-white" : "text-slate-800")}>
              {processKey === "api" ? "API" : "Core (Scheduler)"}
            </p>
            <p className={cn("text-xs", isSelected ? "text-slate-400" : "text-slate-500")}>
              {uptimeSeconds !== null ? `uptime ${formatUptime(uptimeSeconds)}` : "sin uptime"}
            </p>
          </div>
        </div>

        {/* Right: status badge + metrics + buttons */}
        <div className="flex shrink-0 items-center gap-3">
          {/* Status badge */}
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", statusDot)} />
            <span className={cn("text-xs font-medium", isSelected ? "text-slate-300" : "text-slate-600")}>
              {statusLabel}
            </span>
          </span>

          {/* Metrics */}
          {metrics && (
            <div className={cn("flex gap-4 text-right text-xs", isSelected ? "text-slate-400" : "text-slate-500")}>
              <div>
                <span className="block font-mono font-semibold">
                  {metrics.cpu_pct !== null ? `${metrics.cpu_pct.toFixed(1)}%` : "—"}
                </span>
                <span className="block uppercase tracking-wide" style={{ fontSize: 9 }}>CPU</span>
              </div>
              <div>
                <span className="block font-mono font-semibold">{formatMem(metrics.mem_bytes)}</span>
                <span className="block uppercase tracking-wide" style={{ fontSize: 9 }}>MEM</span>
              </div>
            </div>
          )}

          {/* Control buttons (Core only) */}
          {canControl && (
            <div
              className="flex gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {status === "running" ? (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={onRestart}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  title="Reiniciar el scheduler"
                >
                  {actionLoading ? "Reiniciando…" : "Reiniciar"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={onStart}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  title="Iniciar el scheduler"
                >
                  {actionLoading ? "Iniciando…" : "Iniciar"}
                </button>
              )}
            </div>
          )}

          {processKey === "core" && !canControl && schedulerStatus && (
            <span className="text-xs text-slate-400" title="Agregá EMBED_SCHEDULER=true al .env y reiniciá la API">
              Modo externo
            </span>
          )}

          {/* Expand arrow */}
          <span className={cn("text-xs", isSelected ? "text-slate-400" : "text-slate-400")}>
            {isSelected ? "▲" : "▼"}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Charts (unchanged from original) ─────────────────────────────────────────

type ChartPoint = Record<string, number | string | null>;

function buildChartData(history: ProcessMetricSnapshot[], metric: "cpu_pct" | "mem_bytes"): ChartPoint[] {
  const byTime = new Map<string, ChartPoint>();
  for (const row of history) {
    const t = formatTime(row.recorded_at);
    if (!byTime.has(t)) byTime.set(t, { time: t });
    const point = byTime.get(t)!;
    point[row.process] = metric === "cpu_pct"
      ? row.cpu_pct
      : row.mem_bytes !== null ? Math.round(row.mem_bytes / 1024 / 1024) : null;
  }
  return Array.from(byTime.values());
}

function MetricChart({
  history, metric, label, unit, processes,
}: {
  history: ProcessMetricSnapshot[];
  metric: "cpu_pct" | "mem_bytes";
  label: string;
  unit: string;
  processes: string[];
}) {
  const data = buildChartData(history, metric);
  if (data.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => `${v}${unit}`} width={42} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: "#e2e8f0" }} formatter={(value) => [`${value ?? "—"}${unit}`]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {processes.map((proc) => (
            <Line key={proc} type="monotone" dataKey={proc} stroke={PROCESS_COLORS[proc] ?? "#64748b"} dot={false} strokeWidth={1.5} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProcessesSection() {
  const token = useAuthStore((s) => s.token);

  // Metrics (CPU/mem/uptime)
  const [metricsData, setMetricsData] = useState<ProcessMetricsData | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Scheduler status
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatusData | null>(null);

  // Selected process for log panel
  const [selectedProcess, setSelectedProcess] = useState<ProcessKey | null>(null);

  // Logs per process
  const [coreLogs, setCoreLogs] = useState<SchedulerLogLine[]>([]);
  const [apiLogs, setApiLogs] = useState<SchedulerLogLine[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Metrics + scheduler status polling ────────────────────────────────────
  const fetchMetrics = useCallback(() => {
    if (!token) return;
    void getProcessMetrics(token)
      .then((res) => { setMetricsData(res.data); setMetricsError(null); })
      .catch((err) => setMetricsError(err instanceof Error ? err.message : "Error al cargar métricas."))
      .finally(() => setMetricsLoading(false));

    void getSchedulerStatus(token)
      .then((res) => setSchedulerStatus(res.data))
      .catch(() => null); // non-fatal
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchMetrics();
    const id = setInterval(fetchMetrics, POLL_METRICS_MS);
    return () => clearInterval(id);
  }, [token, fetchMetrics]);

  // ── Log polling (only when a panel is open) ───────────────────────────────
  useEffect(() => {
    if (!token || !selectedProcess) return;

    const fetchLogs = () => {
      setLogsLoading(true);
      if (selectedProcess === "core") {
        void getSchedulerLogs(token, 200)
          .then((res) => setCoreLogs(res.data))
          .catch(() => null)
          .finally(() => setLogsLoading(false));
      } else {
        void getApiLogs(token, 200)
          .then((res) => setApiLogs(res.data))
          .catch(() => null)
          .finally(() => setLogsLoading(false));
      }
    };

    fetchLogs();
    const id = setInterval(fetchLogs, POLL_LOGS_MS);
    return () => clearInterval(id);
  }, [token, selectedProcess]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleStart() {
    if (!token) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await startScheduler(token);
      await getSchedulerStatus(token).then((res) => setSchedulerStatus(res.data));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo iniciar el scheduler.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRestart() {
    if (!token) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await restartScheduler(token);
      await getSchedulerStatus(token).then((res) => setSchedulerStatus(res.data));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo reiniciar el scheduler.");
    } finally {
      setActionLoading(false);
    }
  }

  function toggleProcess(key: ProcessKey) {
    setSelectedProcess((current) => (current === key ? null : key));
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const latestByProcess = new Map<string, ProcessMetricSnapshot>();
  for (const snap of metricsData?.current ?? []) {
    latestByProcess.set(snap.process, snap);
  }

  const historyProcesses = [...new Set(metricsData?.history.map((r) => r.process) ?? [])];

  // ── Render ─────────────────────────────────────────────────────────────────
  if (metricsLoading && !metricsData) {
    return <p className="text-sm text-slate-500">Cargando datos de procesos…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Snapshot cada 30 s · últimas 2 h · actualización automática cada 3 s.
        {schedulerStatus?.embedded
          ? " — Core embebido activo."
          : " — Agrega EMBED_SCHEDULER=true al .env para controlar el Core desde acá."}
      </p>

      {/* Process control cards */}
      <div className="space-y-2">
        {(["api", "core"] as ProcessKey[]).map((key) => (
          <div key={key}>
            <ProcessControlCard
              processKey={key}
              metrics={latestByProcess.get(key) ?? null}
              schedulerStatus={schedulerStatus}
              isSelected={selectedProcess === key}
              onSelect={() => toggleProcess(key)}
              onStart={handleStart}
              onRestart={handleRestart}
              actionLoading={actionLoading}
            />
            {selectedProcess === key && (
              <div className="mt-1.5">
                <TerminalPanel
                  lines={key === "core" ? coreLogs : apiLogs}
                  loading={logsLoading}
                  placeholder={
                    key === "core"
                      ? "No hay logs del Core disponibles. Si EMBED_SCHEDULER=true, iniciá el proceso desde arriba."
                      : "No hay logs de la API disponibles. Revisá logs/api.log."
                  }
                  onClear={() => key === "core" ? setCoreLogs([]) : setApiLogs([])}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Other processes from metrics (ui, etc.) */}
      {metricsData && metricsData.current.filter((s) => s.process !== "api" && s.process !== "core").length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metricsData.current
            .filter((s) => s.process !== "api" && s.process !== "core")
            .map((snap) => (
              <div key={snap.process} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PROCESS_COLORS[snap.process] ?? "#64748b" }} />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{snap.process}</p>
                    <p className="text-xs text-slate-500">uptime {formatUptime(snap.uptime_seconds)}</p>
                  </div>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="text-xs text-slate-500">CPU</p>
                    <p className="text-sm font-mono font-semibold text-slate-800">
                      {snap.cpu_pct !== null ? `${snap.cpu_pct.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">MEM</p>
                    <p className="text-sm font-mono font-semibold text-slate-800">{formatMem(snap.mem_bytes)}</p>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</div>
      )}

      {metricsError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{metricsError}</div>
      )}

      {/* Historical charts */}
      {metricsData && metricsData.history.length > 1 && (
        <div className="grid gap-6 md:grid-cols-2">
          <MetricChart history={metricsData.history} metric="cpu_pct" label="CPU %" unit="%" processes={historyProcesses} />
          <MetricChart history={metricsData.history} metric="mem_bytes" label="Memoria (MB)" unit=" MB" processes={historyProcesses} />
        </div>
      )}
    </div>
  );
}
