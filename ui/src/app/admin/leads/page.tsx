"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { listLeads, type LeadDashboard } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const TIER_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-gray-100 text-gray-700",
  X: "bg-red-100 text-red-700",
};

const URGENCY_COLORS: Record<string, string> = {
  high: "text-red-600",
  medium: "text-yellow-600",
  low: "text-gray-400",
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return (
    <span className={cn("inline-block px-1.5 py-0.5 rounded text-xs font-semibold", TIER_COLORS[tier] ?? "bg-gray-100 text-gray-700")}>
      {tier}
    </span>
  );
}

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function LeadsPage() {
  const token = useAuthStore((s) => s.token);

  const [leads, setLeads] = useState<LeadDashboard[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [niche, setNiche] = useState("");
  const [source, setSource] = useState("");
  const [tier, setTier] = useState("");
  const [minScore, setMinScore] = useState("");

  const debouncedQ = useDebounce(q, 350);

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listLeads(token, {
          q: debouncedQ || undefined,
          niche: niche || undefined,
          source: source || undefined,
          contact_tier: tier || undefined,
          prospect_score_gte: minScore ? Number(minScore) : undefined,
          cursor,
          limit: 50,
        });
        if (cursor) {
          setLeads((prev) => [...prev, ...res.data]);
        } else {
          setLeads(res.data);
        }
        setTotal(res.total);
        setNextCursor(res.next_cursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar leads");
      } finally {
        setLoading(false);
      }
    },
    [token, debouncedQ, niche, source, tier, minScore]
  );

  const isInitial = useRef(true);
  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
    }
    setLeads([]);
    setNextCursor(null);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, niche, source, tier, minScore, token]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Lead Explorer</h1>
        <span className="text-sm text-gray-500">{total} leads</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="search"
          placeholder="Buscar nombre, dirección, niche..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <input
          type="text"
          placeholder="Niche"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Todas las fuentes</option>
          <option value="yelu">Yelu</option>
          <option value="pedidosya">PedidosYa</option>
          <option value="mintur">MINTUR</option>
          <option value="osm">OSM</option>
          <option value="google_places">Google Places</option>
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Todos los tiers</option>
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
          <option value="D">Tier D</option>
          <option value="X">Tier X</option>
        </select>
        <input
          type="number"
          placeholder="Score mín."
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          min={0}
          max={100}
          className="border rounded px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Niche</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fuente</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Score</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Oferta</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Urgencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/leads/${lead.id}`}
                    className="text-brand-600 hover:underline font-medium"
                  >
                    {lead.name}
                  </Link>
                  {lead.address && (
                    <p className="text-xs text-gray-400 truncate max-w-xs">{lead.address}</p>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-600">{lead.niche ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className="text-gray-600">{lead.source}</span>
                  {lead.corroborating_sources?.length > 0 && (
                    <span className="ml-1 text-xs text-gray-400">
                      +{lead.corroborating_sources.length}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <TierBadge tier={lead.contact_tier} />
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {lead.prospect_score != null ? (
                    <span className={cn(
                      "font-semibold",
                      lead.prospect_score >= 70 ? "text-green-700" :
                      lead.prospect_score >= 45 ? "text-yellow-700" : "text-gray-500"
                    )}>
                      {lead.prospect_score}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-2 text-gray-600 text-xs">{lead.primary_offer ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600 text-xs">{lead.state}</td>
                <td className="px-4 py-2 text-xs">
                  <span className={URGENCY_COLORS[lead.urgency_signal ?? ""] ?? "text-gray-400"}>
                    {lead.urgency_signal ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
            {leads.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No se encontraron leads
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-4 text-center">
          <button
            onClick={() => load(nextCursor)}
            disabled={loading}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        </div>
      )}

      {loading && leads.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">Cargando leads...</div>
      )}
    </div>
  );
}
