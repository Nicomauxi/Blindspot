"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPageLayout, SectionCard, StatCard } from "@/components/admin-shell";
import {
  ApiError,
  deleteBackupById,
  getBackupsOverview,
  patchBackupConfig,
  restoreBackupById,
  runBackupNow,
  type BackupOverview,
  type BackupRun,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { backupPurposeLabel, backupStatusLabel, canDeleteBackup, canRestoreBackup, formatBackupSize } from "@/lib/backups";
import { cn, formatDate, formatRelative } from "@/lib/utils";

export default function BackupsAdminPage() {
  const token = useAuthStore((s) => s.token);
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cronExpression, setCronExpression] = useState("0 3 * * *");
  const [directory, setDirectory] = useState("");
  const [maxManualBackups, setMaxManualBackups] = useState("7");
  const [maxScheduledBackups, setMaxScheduledBackups] = useState("7");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupRun | null>(null);

  const loadOverview = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (!token) return;
    if (mode === "load") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const res = await getBackupsOverview(token);
      setOverview(res.data);
      setEnabled(res.data.config.enabled);
      setCronExpression(res.data.config.cron_expression);
      setDirectory(res.data.config.directory ?? "");
      setMaxManualBackups(String(res.data.config.max_manual_backups));
      setMaxScheduledBackups(String(res.data.config.max_scheduled_backups));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar backups");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleSave() {
    if (!token || overview?.config.maintenance_mode) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await patchBackupConfig(token, {
        enabled,
        cron_expression: cronExpression,
        directory: directory.trim().length > 0 ? directory.trim() : null,
        max_manual_backups: Number(maxManualBackups),
        max_scheduled_backups: Number(maxScheduledBackups),
      });
      setMessage("Configuracion guardada.");
      await loadOverview("refresh");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar configuracion");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (!token || overview?.config.maintenance_mode) return;
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      await runBackupNow(token);
      setMessage("Backup manual ejecutado.");
      await loadOverview("refresh");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ejecutar backup");
    } finally {
      setRunning(false);
    }
  }

  async function handleRestoreConfirm() {
    if (!token || !restoreCandidate) return;
    setRestoring(restoreCandidate.id);
    setMessage(null);
    setError(null);
    try {
      await restoreBackupById(token, restoreCandidate.id);
      setMessage(`Restore completado desde ${restoreCandidate.filename ?? restoreCandidate.id}. Se genero un checkpoint previo automatico.`);
      setRestoreCandidate(null);
      await loadOverview("refresh");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restaurar backup");
    } finally {
      setRestoring(null);
    }
  }

  async function handleDelete(id: string) {
    if (!token || overview?.config.maintenance_mode) return;
    if (!window.confirm("Se borrara el backup seleccionado. ¿Continuar?")) return;
    setDeletingId(id);
    setMessage(null);
    setError(null);
    try {
      await deleteBackupById(token, id);
      setMessage("Backup borrado.");
      await loadOverview("refresh");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Error al borrar backup");
    } finally {
      setDeletingId(null);
    }
  }

  const maintenanceMode = overview?.config.maintenance_mode || overview?.restore.active?.status === "running";

  return (
    <AdminPageLayout
      eyebrow="Admin"
      title="Backups"
      description="Control operativo de backups manuales, programados y restores guiados con checkpoint previo."
      actions={
        <>
          <button onClick={() => void loadOverview("refresh")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" disabled={refreshing}>
            {refreshing ? "Refrescando..." : "Refrescar"}
          </button>
          <button onClick={() => void handleRunNow()} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50" disabled={running || maintenanceMode}>
            {running ? "Ejecutando..." : "Ejecutar backup ahora"}
          </button>
        </>
      }
    >
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {maintenanceMode ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Restore en curso o mantenimiento activo. Backups manuales, borrados y restores adicionales quedan bloqueados hasta terminar.
        </div>
      ) : null}

      {loading && !overview ? <div className="text-sm text-slate-500">Cargando estado de backups...</div> : null}

      {overview ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Ultimo backup" value={overview.summary.last_backup ? formatDate(overview.summary.last_backup.completed_at ?? overview.summary.last_backup.created_at) : "Nunca"} hint={overview.summary.last_backup ? formatRelative(overview.summary.last_backup.completed_at ?? overview.summary.last_backup.created_at) : undefined} tone={overview.summary.last_backup?.status === "failed" ? "warn" : "info"} />
            <StatCard label="Proximo backup" value={formatDate(overview.summary.next_backup_at)} hint={overview.config.enabled ? "Cron activo" : "Scheduler deshabilitado"} tone={overview.config.enabled ? "good" : "default"} />
            <StatCard label="Scheduler" value={overview.scheduler.status} hint={overview.scheduler.last_tick_at ? `Ultimo tick ${formatRelative(overview.scheduler.last_tick_at)}` : "Sin ejecuciones programadas"} tone={overview.scheduler.cron_active ? "good" : overview.scheduler.status === "maintenance" ? "warn" : "default"} />
            <StatCard label="Directorio" value={overview.config.effective_directory} hint={overview.config.directory_valid ? "Listo para escribir" : overview.config.directory_error ?? "Invalido"} tone={overview.config.directory_valid ? "good" : "warn"} />
            <StatCard label="Peso DB" value={formatBackupSize(overview.summary.database_size_bytes)} hint="Tamaño actual estimado de la base activa" tone="info" />
            <StatCard label="Backups presentes" value={overview.summary.backup_count} hint={`Manual ${overview.summary.retention.manual.count}/${overview.summary.retention.manual.max} · Programados ${overview.summary.retention.scheduled.count}/${overview.summary.retention.scheduled.max}`} tone="info" />
            <StatCard label="Ultimo restore" value={overview.summary.last_restore ? formatDate(overview.summary.last_restore.completed_at ?? overview.summary.last_restore.started_at) : "Nunca"} hint={overview.summary.last_restore ? overview.summary.last_restore.status : "Sin restores registrados"} tone={overview.summary.last_restore?.status === "failed" ? "warn" : "default"} />
          </div>

          <SectionCard title="Configuracion" description="La retencion ahora se define por trigger. Los checkpoints de restore usan la banda manual.">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2 text-sm text-slate-700">
                <span className="font-medium">Cron</span>
                <input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" placeholder="0 3 * * *" disabled={maintenanceMode} />
              </label>
              <label className="space-y-2 text-sm text-slate-700 xl:col-span-2">
                <span className="font-medium">Directorio destino</span>
                <input value={directory} onChange={(event) => setDirectory(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={overview.config.effective_directory} disabled={maintenanceMode} />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span className="font-medium">Maximo manual</span>
                <input value={maxManualBackups} onChange={(event) => setMaxManualBackups(event.target.value)} type="number" min={1} max={365} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={maintenanceMode} />
              </label>
              <label className="space-y-2 text-sm text-slate-700">
                <span className="font-medium">Maximo programado</span>
                <input value={maxScheduledBackups} onChange={(event) => setMaxScheduledBackups(event.target.value)} type="number" min={1} max={365} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={maintenanceMode} />
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 xl:col-span-2">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300" disabled={maintenanceMode} />
                <span>
                  <span className="block font-medium text-slate-900">Activar programacion</span>
                  <span className="block text-slate-500">Permite que el scheduler ejecute backups automaticos.</span>
                </span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={() => void handleSave()} disabled={saving || maintenanceMode} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Guardando..." : "Guardar configuracion"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Retencion" description="Manual y programado se podan por separado para que los restores no consuman la cuota del scheduler.">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard label="Retencion manual" value={overview.summary.retention.manual.count} hint={`Limite ${overview.summary.retention.manual.max}`} tone="info" />
              <StatCard label="Retencion programada" value={overview.summary.retention.scheduled.count} hint={`Limite ${overview.summary.retention.scheduled.max}`} tone="info" />
              <StatCard label="Checkpoints restore" value={overview.summary.restore_checkpoint_count} hint="Contados dentro de manual" tone="default" />
            </div>
          </SectionCard>

          <SectionCard title="Capacidad" description="Se expone tamaño actual de DB y huella agregada de backups retenidos para operar sin entrar al filesystem.">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard label="Peso DB" value={formatBackupSize(overview.summary.database_size_bytes)} hint="Base activa local" tone="info" />
              <StatCard label="Backups retenidos" value={formatBackupSize(overview.summary.stored_backup_size_bytes)} hint="Suma de archivos activos" tone="info" />
              <StatCard label="Programados almacenados" value={formatBackupSize(overview.summary.stored_backup_size_by_trigger.scheduled)} hint={`Manuales ${formatBackupSize(overview.summary.stored_backup_size_by_trigger.manual)}`} tone="default" />
            </div>
          </SectionCard>

          <SectionCard title="Alertas" description="No se ocultan fallos operativos. Si algo esta degradado, queda visible aca y en Health.">
            <div className="space-y-2">
              {overview.alerts.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">Sin alertas activas.</div> : overview.alerts.map((alert) => <div key={alert} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">{alert}</div>)}
            </div>
          </SectionCard>

          <SectionCard title="Backups existentes" description="Podés borrar backups finalizados o restaurarlos sobre la base activa. Cada restore crea un checkpoint previo automatico.">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="px-3 py-3 font-medium">Nombre</th>
                    <th className="px-3 py-3 font-medium">Tamano</th>
                    <th className="px-3 py-3 font-medium">Fecha</th>
                    <th className="px-3 py-3 font-medium">Tipo</th>
                    <th className="px-3 py-3 font-medium">Estado</th>
                    <th className="px-3 py-3 font-medium">Detalle</th>
                    <th className="px-3 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.recent.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay backups registrados todavia.</td>
                    </tr>
                  ) : overview.recent.map((backup) => (
                    <tr key={backup.id}>
                      <td className="px-3 py-3 font-medium text-slate-900">{backup.filename ?? backup.id}</td>
                      <td className="px-3 py-3 text-slate-600">{formatBackupSize(backup.size_bytes)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(backup.completed_at ?? backup.created_at)}</td>
                      <td className="px-3 py-3 text-slate-600">{backupPurposeLabel(backup.purpose)} · {backup.trigger}</td>
                      <td className="px-3 py-3">
                        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", backup.status === "completed" ? "bg-emerald-100 text-emerald-700" : backup.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700")}>{backupStatusLabel(backup.status)}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{backup.error_message ?? backup.cleanup_error_message ?? "—"}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {canRestoreBackup(backup.status, backup.deleted_at) ? (
                            <button onClick={() => setRestoreCandidate(backup)} disabled={Boolean(restoring) || maintenanceMode} className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                              Restaurar
                            </button>
                          ) : null}
                          {canDeleteBackup(backup.status, backup.deleted_at) ? (
                            <button onClick={() => void handleDelete(backup.id)} disabled={deletingId === backup.id || maintenanceMode} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                              {deletingId === backup.id ? "Borrando..." : "Borrar"}
                            </button>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {restoreCandidate ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Confirmar restore</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">Restaurar {restoreCandidate.filename ?? restoreCandidate.id}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Esta accion reemplaza la base activa local. Antes de restaurar se generara un checkpoint automatico del estado actual, que luego entra en la retencion manual normal de backups.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => setRestoreCandidate(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" disabled={Boolean(restoring)}>
                  Cancelar
                </button>
                <button onClick={() => void handleRestoreConfirm()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50" disabled={Boolean(restoring)}>
                  {restoring === restoreCandidate.id ? "Restaurando..." : "Confirmar restore"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </AdminPageLayout>
  );
}
