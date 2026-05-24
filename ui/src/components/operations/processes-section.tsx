"use client";

import { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { getProcessMetrics, type ProcessMetricSnapshot, type ProcessMetricsData } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const POLL_MS = 3_000;
const PROCESS_COLORS: Record<string, string> = {
  api: "#0ea5e9",
  core: "#8b5cf6",
  ui: "#10b981",
};

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

function ProcessCard({ snap }: { snap: ProcessMetricSnapshot }) {
  const color = PROCESS_COLORS[snap.process] ?? "#64748b";
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
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
  );
}

type ChartPoint = Record<string, number | string | null>;

function buildChartData(history: ProcessMetricSnapshot[], metric: "cpu_pct" | "mem_bytes"): ChartPoint[] {
  const byTime = new Map<string, ChartPoint>();
  for (const row of history) {
    const t = formatTime(row.recorded_at);
    if (!byTime.has(t)) byTime.set(t, { time: t });
    const point = byTime.get(t)!;
    if (metric === "cpu_pct") {
      point[row.process] = row.cpu_pct;
    } else {
      point[row.process] = row.mem_bytes !== null ? Math.round(row.mem_bytes / 1024 / 1024) : null;
    }
  }
  return Array.from(byTime.values());
}

function MetricChart({
  history,
  metric,
  label,
  unit,
  processes,
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
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v) => `${v}${unit}`}
            width={42}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: "#e2e8f0" }}
            formatter={(value) => [`${value ?? "—"}${unit}`]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {processes.map((proc) => (
            <Line
              key={proc}
              type="monotone"
              dataKey={proc}
              stroke={PROCESS_COLORS[proc] ?? "#64748b"}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProcessesSection() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<ProcessMetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!token) return;

    const fetch = () => {
      getProcessMetrics(token)
        .then((res) => { setData(res.data); setError(null); })
        .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar métricas."))
        .finally(() => setLoading(false));
    };

    fetch();
    timerRef.current = setInterval(fetch, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [token]);

  if (loading) return <p className="text-sm text-slate-500">Cargando métricas de procesos…</p>;
  if (error) return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
  );
  if (!data || data.current.length === 0) return (
    <p className="text-sm text-slate-500">Sin datos. Los snapshots se graban cada 30 s; volvé en un momento.</p>
  );

  const processes = [...new Set(data.history.map((r) => r.process))];

  return (
    <div className="space-y-4">
      <p className="text-sm theme-text-muted">
        Snapshot cada 30 s · últimas 2 h · actualización automática cada 3 s.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.current.map((snap) => (
          <ProcessCard key={snap.process} snap={snap} />
        ))}
      </div>

      {data.history.length > 1 && (
        <div className="grid gap-6 md:grid-cols-2">
          <MetricChart
            history={data.history}
            metric="cpu_pct"
            label="CPU %"
            unit="%"
            processes={processes}
          />
          <MetricChart
            history={data.history}
            metric="mem_bytes"
            label="Memoria (MB)"
            unit=" MB"
            processes={processes}
          />
        </div>
      )}
    </div>
  );
}
