"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSegments, type SegmentEntry, type SegmentsData } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

function SegmentTable({
  title,
  rows,
  filterKey,
  colorFn,
}: {
  title: string;
  rows: SegmentEntry[];
  filterKey: "niche" | "source" | "contact_tier";
  colorFn?: (v: string) => string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="bg-white border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">{title}</h2>
      <div className="space-y-1.5">
        {rows.slice(0, 20).map((row) => (
          <div key={row.value} className="flex items-center gap-3 text-sm group">
            <div className="w-28 shrink-0">
              <Link
                href={`/admin/leads?${filterKey}=${encodeURIComponent(row.value)}`}
                className="text-brand-600 hover:underline truncate block"
              >
                {row.value}
              </Link>
            </div>
            <div className="flex-1 relative h-5 bg-gray-100 rounded overflow-hidden">
              <div
                className={cn("h-full rounded transition-all", colorFn?.(row.value) ?? "bg-brand-500")}
                style={{ width: `${(row.count / max) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center px-1.5 text-xs font-medium text-gray-700">
                {row.count}
              </span>
            </div>
            <div className="w-16 text-right text-xs text-gray-400 font-mono">
              {row.avg_score != null ? `~${row.avg_score}` : "—"}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-gray-400">Sin datos</p>
        )}
      </div>
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  A: "bg-green-400",
  B: "bg-blue-400",
  C: "bg-yellow-400",
  D: "bg-gray-300",
  X: "bg-red-300",
};

export default function SegmentsPage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<SegmentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getSegments(token)
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar segmentos"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando segmentos...</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-3 text-sm">{error}</div>
  );
  if (!data) return null;

  const totalLeads = data.by_source.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Segment Explorer</h1>
        <span className="text-sm text-gray-500">{totalLeads} leads totales</span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Clic en un segmento para abrir el Lead Explorer filtrado. Columna derecha: score promedio.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SegmentTable
          title="Por niche"
          rows={data.by_niche}
          filterKey="niche"
        />
        <SegmentTable
          title="Por tier de contacto"
          rows={data.by_tier}
          filterKey="contact_tier"
          colorFn={(v) => TIER_COLORS[v] ?? "bg-gray-300"}
        />
        <SegmentTable
          title="Por fuente"
          rows={data.by_source}
          filterKey="source"
          colorFn={() => "bg-indigo-400"}
        />
      </div>
    </div>
  );
}
