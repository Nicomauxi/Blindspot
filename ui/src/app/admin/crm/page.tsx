"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  addTrackingNote,
  getTracking,
  listTrackings,
  transitionTracking,
  type CrmStatus,
  type LeadTracking,
  type LeadTrackingDetail,
  type LeadTrackingEvent,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { AdminPageLayout, HelpTip } from "@/components/admin-shell";
import { cn, formatRelative } from "@/lib/utils";
import { CRM_COLUMNS, VALID_TRANSITIONS, groupTrackingsByStatus, isRegressionTransition, isTerminalStatus } from "@/lib/crm-tracking";

type TransitionModal = {
  tracking: LeadTracking;
  to_status: CrmStatus;
  notes: string;
  channel: string;
  reminder_at: string;
  isRegression: boolean;
};

type NoteModal = {
  tracking: LeadTracking;
  notes: string;
};

type DetailModal = {
  trackingId: string;
  detail: LeadTrackingDetail | null;
  loading: boolean;
};

const STATUS_SUGGESTS_NOTES: Set<CrmStatus> = new Set(["rejected", "accepted", "validation"]);
const STATUS_SHOWS_CHANNEL:  Set<CrmStatus> = new Set(["contact"]);
const STATUS_SHOWS_REMINDER: Set<CrmStatus> = new Set(["observed"]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CrmBoardPage() {
  const token = useAuthStore((s) => s.token);
  const role   = useAuthStore((s) => s.role);

  const [trackings, setTrackings]   = useState<LeadTracking[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [transition, setTransition] = useState<TransitionModal | null>(null);
  const [noteModal, setNoteModal]   = useState<NoteModal | null>(null);
  const [detail, setDetail]         = useState<DetailModal | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listTrackings(token, { limit: 100 });
      setTrackings(res.data ?? []);
    } catch {
      setError("Error cargando seguimientos.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const ownerFilterValid = ownerFilter && UUID_REGEX.test(ownerFilter);
  const grouped = groupTrackingsByStatus(
    trackings,
    role === "admin" && ownerFilterValid ? ownerFilter : undefined
  );
  const byStatus = (status: CrmStatus) => grouped[status] ?? [];

  const openTransition = (tracking: LeadTracking, to_status: CrmStatus) =>
    setTransition({
      tracking, to_status, notes: "", channel: "", reminder_at: "",
      isRegression: isRegressionTransition(tracking.status, to_status),
    });

  const openNoChannelWorked = (tracking: LeadTracking) =>
    setTransition({
      tracking,
      to_status: "observed",
      notes: "Ningún canal funcionó",
      channel: "",
      reminder_at: "",
      isRegression: false,
    });

  const openNote = (tracking: LeadTracking) =>
    setNoteModal({ tracking, notes: "" });

  const openDetail = async (trackingId: string) => {
    if (!token) return;
    setDetail({ trackingId, detail: null, loading: true });
    try {
      const res = await getTracking(token, trackingId);
      setDetail({ trackingId, detail: res.data, loading: false });
    } catch {
      setDetail({ trackingId, detail: null, loading: false });
    }
  };

  const closeAll = () => {
    setTransition(null);
    setNoteModal(null);
    setDetail(null);
    setSaveError(null);
  };

  const handleTransition = async () => {
    if (!token || !transition) return;
    setSaving(true);
    setSaveError(null);
    try {
      await transitionTracking(token, transition.tracking.id, {
        to_status:   transition.to_status,
        notes:       transition.notes || undefined,
        channel:     transition.channel || undefined,
        reminder_at: transition.reminder_at || undefined,
      });
      closeAll();
      await load();
    } catch {
      setSaveError("Error al transicionar.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!token || !noteModal || !noteModal.notes.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await addTrackingNote(token, noteModal.tracking.id, noteModal.notes.trim());
      closeAll();
    } catch {
      setSaveError("Error al guardar la nota.");
    } finally {
      setSaving(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || !token) return;

    const trackingId = active.id as string;
    const toStatus = over.id as CrmStatus;
    const tracking = trackings.find((t) => t.id === trackingId);
    if (!tracking || tracking.status === toStatus) return;
    if (!VALID_TRANSITIONS[tracking.status].includes(toStatus)) return;

    // Regressions require a note — open modal instead of direct commit
    if (isRegressionTransition(tracking.status, toStatus)) {
      openTransition(tracking, toStatus);
      return;
    }

    // Optimistic update for forward transitions
    setTrackings((prev) =>
      prev.map((t) => (t.id === trackingId ? { ...t, status: toStatus } : t))
    );

    try {
      await transitionTracking(token, trackingId, { to_status: toStatus });
    } catch {
      // Revert on failure
      await load();
    }
  };

  const draggingTracking = draggingId ? trackings.find((t) => t.id === draggingId) : null;

  return (
    <AdminPageLayout
      title="CRM — Board de seguimiento"
      description="Seguimientos activos por etapa"
      actions={
        role === "admin" ? (
          <div className="flex items-center gap-2">
            <label className="text-xs theme-text-muted">Filtrar por owner:</label>
            <input
              className={cn(
                "rounded-lg border px-2 py-1 text-xs theme-input w-60",
                ownerFilter && !ownerFilterValid && "border-rose-400"
              )}
              placeholder="uuid del usuario…"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
            />
            {ownerFilter && !ownerFilterValid && (
              <span className="text-xs text-rose-500">UUID inválido</span>
            )}
          </div>
        ) : undefined
      }
    >
      <HelpTip label="CRM">
        Board de seguimiento por etapa. Arrastrá cards entre columnas para moverlas. Hacé clic en el nombre del lead para ver el historial completo. Usá los botones de transición para mover un lead entre etapas.
      </HelpTip>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
          {error}
        </div>
      )}

      {loading && !trackings.length && (
        <div className="text-sm theme-text-muted py-8 text-center">Cargando…</div>
      )}

      {/* Board */}
      <DndContext
        onDragStart={(e) => setDraggingId(e.active.id as string)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {CRM_COLUMNS.map(({ status, label, color }) => {
            const cards = byStatus(status);
            return (
              <DroppableColumn key={status} status={status}>
                <div className="flex items-center justify-between mb-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", color)}>{label}</span>
                  <span className="text-xs theme-text-muted font-medium">{cards.length}</span>
                </div>
                <div className="space-y-2 min-h-[60px]">
                  {cards.length === 0 && (
                    <div className="rounded-xl border border-dashed px-3 py-4 text-xs theme-text-muted text-center">
                      Sin leads
                    </div>
                  )}
                  {cards.map((t) => (
                    <DraggableCard key={t.id} tracking={t}>
                      <TrackingCard
                        tracking={t}
                        isAdmin={role === "admin"}
                        isDragging={draggingId === t.id}
                        onTransition={(to) => openTransition(t, to)}
                        onNoChannelWorked={() => openNoChannelWorked(t)}
                        onAddNote={() => openNote(t)}
                        onOpenDetail={() => openDetail(t.id)}
                      />
                    </DraggableCard>
                  ))}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
        <DragOverlay>
          {draggingTracking && (
            <TrackingCard
              tracking={draggingTracking}
              isAdmin={role === "admin"}
              isDragging
              onTransition={() => undefined}
              onNoChannelWorked={() => undefined}
              onAddNote={() => undefined}
              onOpenDetail={() => undefined}
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Transition modal */}
      {transition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="theme-panel w-full max-w-md rounded-2xl p-6 shadow-xl">
            <h2 className="text-base font-semibold theme-text-strong mb-1">
              {transition.isRegression ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700">Retroceso</span>
                  <span>← <span className="capitalize">{transition.to_status}</span></span>
                </span>
              ) : isTerminalStatus(transition.tracking.status) ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-rose-100 text-rose-700">Reapertura</span>
                  <span>Reabrir en <span className="capitalize">{transition.to_status}</span></span>
                </span>
              ) : (
                <>Mover a <span className="capitalize">{transition.to_status}</span></>
              )}
            </h2>
            <p className="text-xs theme-text-muted mb-4 truncate">
              {transition.tracking.lead_name ?? transition.tracking.lead_id}
            </p>

            {transition.isRegression && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Estás revirtiendo el seguimiento. Se requiere una razón.
              </div>
            )}

            {isTerminalStatus(transition.tracking.status) && !transition.isRegression && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Este lead estaba en estado terminal. Reabrirlo requiere confirmar con una nota explicativa.
              </div>
            )}

            {STATUS_SHOWS_CHANNEL.has(transition.to_status) && (
              <div className="mb-3">
                <label className="text-xs theme-text-muted block mb-1">Canal utilizado (opcional)</label>
                <input
                  className="w-full rounded-lg border px-3 py-1.5 text-sm theme-input"
                  placeholder="whatsapp / email / teléfono…"
                  value={transition.channel}
                  onChange={(e) => setTransition({ ...transition, channel: e.target.value })}
                />
              </div>
            )}

            {STATUS_SHOWS_REMINDER.has(transition.to_status) && (
              <div className="mb-3">
                <label className="text-xs theme-text-muted block mb-1">Recordatorio (opcional)</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border px-3 py-1.5 text-sm theme-input"
                  value={transition.reminder_at}
                  onChange={(e) => setTransition({ ...transition, reminder_at: e.target.value })}
                />
              </div>
            )}

            <div className="mb-4">
              <label className="text-xs theme-text-muted block mb-1">
                {transition.isRegression || isTerminalStatus(transition.tracking.status)
                  ? "Razón del retroceso (obligatorio)"
                  : STATUS_SUGGESTS_NOTES.has(transition.to_status)
                  ? "Notas (recomendado)"
                  : "Notas (opcional)"}
              </label>
              <textarea
                className="w-full rounded-lg border px-3 py-1.5 text-sm theme-input resize-none"
                rows={3}
                placeholder={
                  transition.isRegression || isTerminalStatus(transition.tracking.status)
                    ? "Explicá por qué se revierte este seguimiento…"
                    : STATUS_SUGGESTS_NOTES.has(transition.to_status)
                    ? "Describí el motivo de la decisión…"
                    : "Contexto de la transición…"
                }
                value={transition.notes}
                onChange={(e) => setTransition({ ...transition, notes: e.target.value })}
                autoFocus={transition.isRegression || isTerminalStatus(transition.tracking.status)}
              />
            </div>

            {saveError && <p className="text-xs text-rose-600 mb-3">{saveError}</p>}

            <div className="flex justify-end gap-2">
              <button className="rounded-lg px-4 py-2 text-sm theme-text-muted" onClick={closeAll} disabled={saving}>
                Cancelar
              </button>
              <button
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60",
                  transition.isRegression || isTerminalStatus(transition.tracking.status)
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-sky-600 hover:bg-sky-700"
                )}
                onClick={handleTransition}
                disabled={
                  saving ||
                  ((transition.isRegression || isTerminalStatus(transition.tracking.status)) && !transition.notes.trim())
                }
              >
                {saving ? "Guardando…" : transition.isRegression || isTerminalStatus(transition.tracking.status) ? "Confirmar retroceso" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="theme-panel w-full max-w-md rounded-2xl p-6 shadow-xl">
            <h2 className="text-base font-semibold theme-text-strong mb-3">Agregar nota</h2>
            <textarea
              className="w-full rounded-lg border px-3 py-1.5 text-sm theme-input resize-none mb-4"
              rows={4}
              placeholder="Nota de seguimiento…"
              value={noteModal.notes}
              onChange={(e) => setNoteModal({ ...noteModal, notes: e.target.value })}
              autoFocus
            />
            {saveError && <p className="text-xs text-rose-600 mb-3">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <button className="rounded-lg px-4 py-2 text-sm theme-text-muted" onClick={closeAll} disabled={saving}>
                Cancelar
              </button>
              <button
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                onClick={handleAddNote}
                disabled={saving || !noteModal.notes.trim()}
              >
                {saving ? "Guardando…" : "Guardar nota"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="theme-panel w-full max-w-lg rounded-2xl p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-semibold theme-text-strong">
                {detail.detail?.lead?.name ?? detail.detail?.lead_name ?? "Seguimiento"}
              </h2>
              <button className="text-xs theme-text-muted hover:underline ml-4 shrink-0" onClick={closeAll}>Cerrar</button>
            </div>
            {detail.loading && <p className="text-sm theme-text-muted">Cargando…</p>}
            {!detail.loading && !detail.detail && (
              <p className="text-sm text-rose-600">No se pudo cargar el detalle.</p>
            )}
            {detail.detail && (
              <>
                {/* Lead data */}
                <div className="rounded-xl border px-3 py-2 mb-4 space-y-1 text-xs theme-text-muted">
                  {detail.detail.lead?.niche && (
                    <p>Rubro: <span className="theme-text-strong">{detail.detail.lead.niche}</span></p>
                  )}
                  {detail.detail.lead?.address && (
                    <p>Dirección: <span className="theme-text-strong">{detail.detail.lead.address}</span></p>
                  )}
                  {detail.detail.lead?.phone && (
                    <p>Teléfono: <span className="theme-text-strong">{detail.detail.lead.phone}</span></p>
                  )}
                  {detail.detail.lead?.website && (
                    <p>Web: <a href={detail.detail.lead.website} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">{detail.detail.lead.website}</a></p>
                  )}
                  <p>
                    <Link href={`/admin/leads/${detail.detail.lead_id}`} className="text-sky-600 hover:underline">
                      Ver ficha del lead →
                    </Link>
                  </p>
                </div>

                {/* Events timeline */}
                {detail.detail.events.length === 0 ? (
                  <p className="text-sm theme-text-muted mb-4">Sin eventos registrados aún.</p>
                ) : (
                  <div className="space-y-3 mb-4">
                    {detail.detail.events.map((ev: LeadTrackingEvent) => (
                      <div key={ev.id} className="border-l-2 pl-3 py-1" style={{ borderColor: "var(--sidebar-border)" }}>
                        <div className="flex items-center gap-2 text-xs">
                          {ev.from_status === ev.to_status ? (
                            <span className="theme-text-muted italic">nota</span>
                          ) : (
                            <span className="theme-text-muted">
                              {ev.from_status ?? "—"} → <strong className="theme-text-strong capitalize">{ev.to_status}</strong>
                            </span>
                          )}
                          <span className="theme-text-muted">· {formatRelative(ev.created_at)}</span>
                          <span className="theme-text-muted">· {ev.actor_role}</span>
                        </div>
                        {ev.channel && <p className="text-xs theme-text-muted">Canal: {ev.channel}</p>}
                        {ev.reminder_at && <p className="text-xs theme-text-muted">Recordatorio: {new Date(ev.reminder_at).toLocaleString("es-UY")}</p>}
                        {ev.notes && <p className="text-xs theme-text-strong mt-0.5">{ev.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Transition controls */}
                {VALID_TRANSITIONS[detail.detail.status].length > 0 && (
                  <div className="border-t pt-3">
                    <p className="text-xs theme-text-muted mb-2">
                      {isTerminalStatus(detail.detail.status) ? "Reabrir en:" : "Mover a:"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {VALID_TRANSITIONS[detail.detail.status].map((to) => {
                        const isRegression = isRegressionTransition(detail.detail!.status, to);
                        const isReopen = isTerminalStatus(detail.detail!.status);
                        return (
                          <button
                            key={to}
                            className={cn(
                              "rounded px-2 py-1 text-xs border capitalize",
                              isRegression || isReopen
                                ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                : "theme-text-muted hover:bg-slate-100"
                            )}
                            onClick={() => {
                              const tracking = trackings.find((t) => t.id === detail.trackingId);
                              if (tracking) { closeAll(); openTransition(tracking, to); }
                            }}
                          >
                            {isRegression || isReopen ? `← ${to}` : `→ ${to}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AdminPageLayout>
  );
}

function DroppableColumn({
  status,
  children,
}: {
  status: CrmStatus;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[230px] w-[230px] shrink-0 rounded-xl p-2 transition-colors",
        isOver && "bg-sky-50/60 dark:bg-sky-900/20"
      )}
    >
      {children}
    </div>
  );
}

function DraggableCard({
  tracking,
  children,
}: {
  tracking: LeadTracking;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tracking.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
    >
      {children}
    </div>
  );
}

function TrackingCard({
  tracking,
  isAdmin,
  isDragging,
  onTransition,
  onNoChannelWorked,
  onAddNote,
  onOpenDetail,
}: {
  tracking: LeadTracking;
  isAdmin: boolean;
  isDragging?: boolean;
  onTransition: (to: CrmStatus) => void;
  onNoChannelWorked: () => void;
  onAddNote: () => void;
  onOpenDetail: () => void;
}) {
  const transitions = VALID_TRANSITIONS[tracking.status];
  const showNoChannelWorked = tracking.status === "contact";
  const isTerminal = isTerminalStatus(tracking.status);
  const displayName = tracking.lead_name ?? `${tracking.lead_id.slice(0, 8)}…`;

  return (
    <div className={cn("theme-panel rounded-xl border p-3 text-xs space-y-1.5", isDragging && "shadow-xl")}>
      <button
        className="block w-full text-left font-medium theme-text-strong hover:underline truncate"
        onClick={onOpenDetail}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {displayName}
      </button>
      <Link
        href={`/admin/leads/${tracking.lead_id}`}
        className="block text-[10px] theme-text-muted hover:underline"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        Ver lead →
      </Link>
      <p className="theme-text-muted">{formatRelative(tracking.started_at)}</p>
      {isAdmin && (
        <p className="theme-text-muted truncate">Owner: {tracking.owner_id?.slice(0, 8) ?? "—"}…</p>
      )}
      {tracking.notes && (
        <p className="theme-text-muted line-clamp-2">{tracking.notes}</p>
      )}
      <div
        className="flex flex-wrap gap-1 pt-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {transitions.map((to) => {
          const isRegression = isRegressionTransition(tracking.status, to);
          return (
            <button
              key={to}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] border capitalize",
                isRegression || isTerminal
                  ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                  : "theme-text-muted hover:bg-slate-100"
              )}
              onClick={() => onTransition(to)}
              title={isRegression || isTerminal ? "Retroceso — requiere nota" : undefined}
            >
              {isRegression || isTerminal ? `← ${to}` : `→ ${to}`}
            </button>
          );
        })}
        {showNoChannelWorked && (
          <button
            className="rounded px-1.5 py-0.5 text-[10px] border border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={onNoChannelWorked}
          >
            Sin canal
          </button>
        )}
        {!isTerminal && (
          <button
            className="rounded px-1.5 py-0.5 text-[10px] border theme-text-muted hover:bg-slate-100"
            onClick={onAddNote}
          >
            + nota
          </button>
        )}
      </div>
    </div>
  );
}
