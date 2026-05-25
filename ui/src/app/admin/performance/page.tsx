"use client";

import { useEffect, useRef, useState } from "react";
import {
  getPerformanceErrors,
  getPerformanceOverview,
  getPerformanceQuality,
  listNicheAliasGroups,
  listDistinctNiches,
  createNicheAliasGroup,
  updateNicheAliasGroup,
  deleteNicheAliasGroup,
  type PerformanceErrorRow,
  type PerformanceOverview,
  type PerformanceQuality,
  type NicheAliasGroup,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("es-UY", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function CoverageBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-mono text-gray-900">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full", value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-400" : "bg-red-400")}
          style={{ width: `${Math.max(value, value > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

type NicheFormMode = "idle" | "create" | { editing: NicheAliasGroup };

export default function PerformancePage() {
  const token = useAuthStore((s) => s.token);
  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  const [quality, setQuality] = useState<PerformanceQuality | null>(null);
  const [errors, setErrors] = useState<PerformanceErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Nichos state
  const [nicheGroups, setNicheGroups] = useState<NicheAliasGroup[]>([]);
  const [distinctNiches, setDistinctNiches] = useState<string[]>([]);
  const [nicheLoading, setNicheLoading] = useState(false);
  const [nicheError, setNicheError] = useState<string | null>(null);
  const [nicheFormMode, setNicheFormMode] = useState<NicheFormMode>("idle");
  const [nicheCanonical, setNicheCanonical] = useState("");
  const [nicheAliasInput, setNicheAliasInput] = useState("");
  const [nicheSaving, setNicheSaving] = useState(false);
  const canonicalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      getPerformanceOverview(token, 30),
      getPerformanceErrors(token, { days: 7, limit: 20 }),
      getPerformanceQuality(token, { days: 30 }),
    ])
      .then(([ov, errRows, qual]) => {
        setOverview(ov.data);
        setErrors(errRows.data);
        setQuality(qual.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar rendimiento"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setNicheLoading(true);
    Promise.all([listNicheAliasGroups(token), listDistinctNiches(token)])
      .then(([groups, distinct]) => {
        setNicheGroups(groups.data);
        setDistinctNiches(distinct.data);
        setNicheError(null);
      })
      .catch((err) => setNicheError(err instanceof Error ? err.message : "Error al cargar nichos"))
      .finally(() => setNicheLoading(false));
  }, [token]);

  function openCreate() {
    setNicheCanonical("");
    setNicheAliasInput("");
    setNicheFormMode("create");
    setTimeout(() => canonicalRef.current?.focus(), 50);
  }

  function openEdit(group: NicheAliasGroup) {
    setNicheCanonical(group.canonical);
    setNicheAliasInput(group.aliases.join(", "));
    setNicheFormMode({ editing: group });
    setTimeout(() => canonicalRef.current?.focus(), 50);
  }

  function cancelNicheForm() {
    setNicheFormMode("idle");
    setNicheCanonical("");
    setNicheAliasInput("");
  }

  function parseAliases(raw: string): string[] {
    return raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function saveNicheGroup() {
    if (!token || !nicheCanonical.trim()) return;
    const aliases = parseAliases(nicheAliasInput);
    setNicheSaving(true);
    try {
      if (nicheFormMode === "create") {
        const { data } = await createNicheAliasGroup(token, nicheCanonical.trim(), aliases);
        setNicheGroups((prev) => [...prev, data].sort((a, b) => a.canonical.localeCompare(b.canonical)));
      } else if (typeof nicheFormMode === "object") {
        const { data } = await updateNicheAliasGroup(token, nicheFormMode.editing.id, nicheCanonical.trim(), aliases);
        setNicheGroups((prev) => prev.map((g) => g.id === data.id ? data : g));
      }
      cancelNicheForm();
    } catch (err) {
      setNicheError(err instanceof Error ? err.message : "Error al guardar grupo");
    } finally {
      setNicheSaving(false);
    }
  }

  async function removeNicheGroup(id: string) {
    if (!token) return;
    try {
      await deleteNicheAliasGroup(token, id);
      setNicheGroups((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      setNicheError(err instanceof Error ? err.message : "Error al eliminar grupo");
    }
  }

  const groupedNiches = new Set(
    nicheGroups.flatMap((g) => [g.canonical, ...g.aliases])
  );
  const ungroupedNiches = distinctNiches.filter((n) => !groupedNiches.has(n));

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-3 text-sm">{error}</div>;

  const maxPhase = overview?.per_phase.reduce((max, row) => Math.max(max, row.avg_min), 0) || 1;
  const topChanges = quality?.changes.significant_changes ?? [];

  return (
    <div className="max-w-6xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-gray-900">Performance Dashboard</h1>
        <p className="text-sm text-gray-500">Runs, errores y calidad de datos de los últimos 30 días.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Runs ejecutados</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{overview?.runs.total ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">
            {overview?.runs.successful ?? 0} completos · {overview?.runs.partial ?? 0} parciales
          </p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Duración promedio</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{overview?.duration.avg_min.toFixed(1) ?? "0.0"} min</p>
          <p className="mt-1 text-xs text-gray-500">Total: {overview?.duration.total_hours.toFixed(2) ?? "0.00"} h</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Errores recientes</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{errors.length}</p>
          <p className="mt-1 text-xs text-gray-500">Ventana: 7 días</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Cambios significativos</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{quality?.changes.significant_total ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">Run de referencia: {quality?.run_id ?? "sin run"}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        <Section title="Tiempo por fase">
          <div className="space-y-3">
            {(overview?.per_phase ?? []).map((phase) => (
              <div key={phase.phase} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800">{phase.phase}</span>
                  <span className="font-mono text-gray-700">{phase.avg_min.toFixed(1)} min · {phase.pct_of_total.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max((phase.avg_min / maxPhase) * 100, phase.avg_min > 0 ? 6 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Throughput">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Leads enriquecidos / hora</span>
              <span className="font-mono text-gray-900">{overview?.throughput.enrich_per_hour.toFixed(1) ?? "0.0"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Leads scoreados / hora</span>
              <span className="font-mono text-gray-900">{overview?.throughput.score_per_hour.toFixed(1) ?? "0.0"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Discovery candidatos / min</span>
              <span className="font-mono text-gray-900">{overview?.throughput.discovery_per_min.toFixed(2) ?? "0.00"}</span>
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        <Section title="Tasa de éxito por fuente">
          <div className="space-y-3">
            {(overview?.success_rate_per_source ?? []).map((row) => (
              <div key={row.source} className="border rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-gray-800">{row.source}</span>
                  <span className="font-mono text-gray-900">{row.pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {row.success}/{row.total} sin error · {row.errors} con error
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Cobertura de datos">
          <div className="space-y-3">
            <CoverageBar label="Email quality conocida" value={quality?.coverage.email_quality_pct ?? 0} />
            <CoverageBar label="Phone type conocido" value={quality?.coverage.phone_type_pct ?? 0} />
            <CoverageBar label="Con coordenadas" value={quality?.coverage.coords_pct ?? 0} />
            <CoverageBar label="Con inferred_state" value={quality?.coverage.inferred_state_pct ?? 0} />
            <CoverageBar label="Con contact tier usable" value={quality?.coverage.contactable_tier_pct ?? 0} />
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
        <Section title="Errores recientes">
          {errors.length ? (
            <div className="space-y-2">
              {errors.map((row) => (
                <div key={row.id} className="border rounded-lg px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-gray-800">{row.phase} · {row.error_type}</div>
                    <div className="text-xs text-gray-500">{fmtDate(row.ts)}</div>
                  </div>
                  <div className="text-sm text-gray-600">{row.message}</div>
                  <div className="text-xs text-gray-500">
                    fuente: {row.source ?? "n/a"} · run: {row.run_id ?? "n/a"} · recovered: {row.recovered ? "sí" : "no"}
                  </div>
                  {row.stack && (
                    <pre className="bg-gray-50 border rounded p-2 text-[11px] text-gray-600 overflow-auto whitespace-pre-wrap">
                      {row.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin errores en la ventana seleccionada.</p>
          )}
        </Section>

        <Section title="Change detection">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Tier gained</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{quality?.changes.tier_gained ?? 0}</div>
            </div>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Tier lost</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{quality?.changes.tier_lost ?? 0}</div>
            </div>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">New hot</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{quality?.changes.new_hot ?? 0}</div>
            </div>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Cambios totales</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{quality?.changes.significant_total ?? 0}</div>
            </div>
          </div>
          <div className="space-y-2">
            {(quality?.changes.by_field ?? []).map((entry) => (
              <div key={entry.field} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{entry.field}</span>
                <span className="font-mono text-gray-900">{entry.count}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Leads con cambios significativos">
        {topChanges.length ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Lead</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">Campo</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">De</th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">A</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Score</th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium text-gray-500">Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topChanges.map((change, idx) => (
                  <tr key={`${change.lead_id}-${change.field}-${idx}`}>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-800">{change.name}</div>
                      <div className="text-xs text-gray-500">{change.source ?? "n/a"} · {fmtDate(change.changed_at)}</div>
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">{change.field}</td>
                    <td className="px-3 py-1.5 text-gray-600">{String(change.from ?? "null")}</td>
                    <td className="px-3 py-1.5 text-gray-600">{String(change.to ?? "null")}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{change.prospect_score ?? "n/a"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{change.contact_tier ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No hay cambios significativos en la ventana seleccionada.</p>
        )}
      </Section>

      <Section title="Nichos — grupos de sinónimos">
        {nicheError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm mb-3">{nicheError}</div>
        )}

        {nicheLoading ? (
          <p className="text-sm text-gray-400">Cargando nichos...</p>
        ) : (
          <>
            {nicheGroups.length > 0 && (
              <div className="space-y-2 mb-4">
                {nicheGroups.map((group) => (
                  <div key={group.id} className="border rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-medium text-gray-800">{group.canonical}</span>
                        {group.aliases.length > 0 && (
                          <span className="ml-2 text-sm text-gray-500">
                            = {group.aliases.join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEdit(group)}
                          className="text-xs text-sky-600 hover:text-sky-800"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => removeNicheGroup(group.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {nicheFormMode !== "idle" && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-3 mb-4">
                <div className="text-sm font-medium text-gray-700">
                  {nicheFormMode === "create" ? "Nuevo grupo de sinónimos" : "Editar grupo"}
                </div>
                <div className="space-y-2">
                  <div>
                    <label htmlFor="niche-canonical" className="text-xs text-gray-500 block mb-1">
                      Nombre canónico
                    </label>
                    <input
                      id="niche-canonical"
                      ref={canonicalRef}
                      type="text"
                      value={nicheCanonical}
                      onChange={(e) => setNicheCanonical(e.target.value)}
                      placeholder="ej: restaurante"
                      className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="niche-aliases" className="text-xs text-gray-500 block mb-1">
                      Sinónimos (separados por coma)
                    </label>
                    <input
                      id="niche-aliases"
                      type="text"
                      value={nicheAliasInput}
                      onChange={(e) => setNicheAliasInput(e.target.value)}
                      placeholder="ej: restaurant, parrilla, parilla"
                      className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveNicheGroup}
                    disabled={nicheSaving || !nicheCanonical.trim()}
                    className="px-3 py-1.5 rounded text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {nicheSaving ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelNicheForm}
                    className="px-3 py-1.5 rounded text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {nicheFormMode === "idle" && (
              <button
                type="button"
                onClick={openCreate}
                className="text-sm text-sky-600 hover:text-sky-800 font-medium"
              >
                + Nuevo grupo
              </button>
            )}

            {ungroupedNiches.length > 0 && (
              <details className="mt-4">
                <summary className="text-sm text-gray-500 cursor-pointer select-none">
                  {ungroupedNiches.length} niches sin grupo
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ungroupedNiches.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setNicheCanonical(n);
                        setNicheAliasInput("");
                        setNicheFormMode("create");
                        setTimeout(() => canonicalRef.current?.focus(), 50);
                      }}
                      className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs hover:bg-sky-50 hover:text-sky-700 border border-gray-200"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
