"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  commitDiscoveryPlacesImport,
  listDiscoveryPlaceImports,
  listDiscoveryPlacesCatalog,
  previewDiscoveryPlacesImport,
  type DiscoveryPlaceCatalogEntry,
  type DiscoveryPlacesImportHistoryEntry,
  type DiscoveryPlacesImportPreview,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { AdminPageLayout, SectionCard } from "@/components/admin-shell";
import { formatRelative } from "@/lib/utils";

function formatKind(kind: string) {
  return kind.replaceAll("_", " ");
}

export default function ImportsPage() {
  const token = useAuthStore((state) => state.token);
  const [catalog, setCatalog] = useState<DiscoveryPlaceCatalogEntry[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [history, setHistory] = useState<DiscoveryPlacesImportHistoryEntry[]>([]);
  const [preview, setPreview] = useState<DiscoveryPlacesImportPreview | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [upsert, setUpsert] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCatalog(query = catalogQuery) {
    if (!token) return;
    setLoadingCatalog(true);
    try {
      const response = await listDiscoveryPlacesCatalog(token, { q: query || undefined, limit: 100 });
      setCatalog(response.data);
      setCatalogTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el catálogo.");
      setCatalog([]);
      setCatalogTotal(0);
    } finally {
      setLoadingCatalog(false);
    }
  }

  async function loadHistory() {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const response = await listDiscoveryPlaceImports(token, 20);
      setHistory(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el historial.");
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    void loadCatalog("");
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const timeout = window.setTimeout(() => {
      void loadCatalog(catalogQuery);
    }, 180);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery, token]);

  async function handleFileSelection(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setNotice(null);
    setError(null);
    if (!file || !token) return;
    setPreviewLoading(true);
    try {
      const response = await previewDiscoveryPlacesImport(token, file);
      setPreview(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleCommit() {
    if (!token || !preview) return;
    setCommitting(true);
    setNotice(null);
    setError(null);
    try {
      const response = await commitDiscoveryPlacesImport(token, {
        filename: preview.filename,
        upsert,
        entries: preview.entries,
      });
      setNotice(
        `Importado: ${response.data.inserted} nuevos, ${response.data.updated} actualizados, ${response.data.skipped} omitidos.`
      );
      setPreview(null);
      setSelectedFile(null);
      await Promise.all([loadCatalog(""), loadHistory()]);
      setCatalogQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la importación.");
    } finally {
      setCommitting(false);
    }
  }

  const sampleEntries = useMemo(() => preview?.entries.slice(0, 8) ?? [], [preview]);

  return (
    <AdminPageLayout
      eyebrow="Plataforma"
      title="Importación"
      description="Cargá XLS de lugares y zonas, revisá preview antes de insertar y dejá el catálogo listo para Discovery y filtros geográficos."
      actions={
        <Link href="/admin/discovery" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
          Volver a Discovery
        </Link>
      }
    >
      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <SectionCard title="Cargar archivo" description="El preview no escribe nada. Primero valida filas, detecta duplicados y recién después confirma la inserción.">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Columnas esperadas</p>
              <p className="mt-2">`location_key`, `display_name`, `kind` y opcionalmente `parent_location`, `lat_approx`, `lng_approx`, `commercial_score`, `notes`.</p>
              <p className="mt-2 text-xs text-slate-500">`notes` puede llevar trazabilidad compacta, por ejemplo `SRC:IMM-MVD+OSM-MANUAL`.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {previewLoading ? "Procesando…" : selectedFile ? selectedFile.name : "Seleccionar .xlsx"}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(event) => void handleFileSelection(event.target.files?.[0] ?? null)}
                  disabled={previewLoading || committing}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={upsert} onChange={(event) => setUpsert(event.target.checked)} className="rounded border-slate-300" />
                Permitir overwrite de `location_key` existentes
              </label>
            </div>

            {preview ? (
              <div className="space-y-4" data-testid="imports-preview-ready">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Filas" value={String(preview.row_count)} />
                  <Metric label="Válidas" value={String(preview.valid_count)} tone="good" />
                  <Metric label="Inválidas" value={String(preview.invalid_count)} tone={preview.invalid_count > 0 ? "warn" : "neutral"} />
                  <Metric label="Duplicadas" value={String(preview.duplicate_count)} tone={preview.duplicate_count > 0 ? "warn" : "neutral"} />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">Preview de filas válidas</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          <th className="px-4 py-2">Key</th>
                          <th className="px-4 py-2">Nombre</th>
                          <th className="px-4 py-2">Tipo</th>
                          <th className="px-4 py-2">Padre</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleEntries.map((entry) => (
                          <tr key={entry.location_key} className="border-t border-slate-100">
                            <td className="px-4 py-2 font-mono text-xs text-slate-700">{entry.location_key}</td>
                            <td className="px-4 py-2 text-slate-800">{entry.display_name}</td>
                            <td className="px-4 py-2 text-slate-600">{formatKind(entry.kind)}</td>
                            <td className="px-4 py-2 text-slate-500">{entry.parent_location ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-sm font-medium text-slate-800">Errores de validación</p>
                    {preview.row_validation_errors.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        {preview.row_validation_errors.slice(0, 10).map((item) => (
                          <li key={`${item.row}-${item.reason}`}>
                            Fila {item.row}: {item.reason}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No hay errores de validación.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-sm font-medium text-slate-800">Duplicados detectados</p>
                    {preview.duplicate_entries.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-sm text-slate-600">
                        {preview.duplicate_entries.slice(0, 10).map((item) => (
                          <li key={item.location_key}>
                            {item.display_name} <span className="font-mono text-xs text-slate-500">({item.location_key})</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No hay duplicados en el catálogo actual.</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleCommit()} disabled={committing || preview.valid_count === 0} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                    {committing ? "Importando…" : "Confirmar importación"}
                  </button>
                  <button type="button" onClick={() => { setPreview(null); setSelectedFile(null); setNotice(null); setError(null); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Descartar preview
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Seleccioná un archivo para generar preview antes de insertar.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Historial de importaciones" description="Las confirmaciones quedan trazadas y el catálogo resultante se puede consultar sin salir de Plataforma.">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800">Eventos recientes</p>
                <button type="button" onClick={() => void loadHistory()} className="text-xs font-medium text-sky-700 hover:underline">
                  Actualizar
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {loadingHistory ? (
                  <p className="text-sm text-slate-500">Cargando historial…</p>
                ) : history.length > 0 ? (
                  history.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-slate-800">{entry.filename ?? "Importación sin nombre"}</p>
                        <span className="text-xs text-slate-500">{formatRelative(entry.occurred_at)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{entry.inserted} nuevos · {entry.updated} actualizados · {entry.skipped} omitidos · {entry.invalid_count} inválidos</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Todavía no hay importaciones confirmadas.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800">Catálogo activo</p>
                <span className="text-xs text-slate-500">{catalogTotal} lugares</span>
              </div>
              <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Buscar por nombre o key…" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <div className="mt-3 space-y-2">
                {loadingCatalog ? (
                  <p className="text-sm text-slate-500">Cargando catálogo…</p>
                ) : catalog.length > 0 ? (
                  catalog.slice(0, 12).map((place) => (
                    <div key={place.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-800">{place.display_name}</p>
                        {place.commercial_score != null ? <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">{place.commercial_score}</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatKind(place.kind)}{place.parent_location ? ` · ${place.parent_location}` : ""}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No hay lugares cargados para este filtro.</p>
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </AdminPageLayout>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  const toneClass = tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
