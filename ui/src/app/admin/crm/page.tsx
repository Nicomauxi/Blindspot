"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  addTrackingNote,
  createLeadFeedback,
  getTracking,
  listTrackings,
  transitionTracking,
  updateTrackingTitle,
  upsertTrackingStageDetails,
  type CrmStatus,
  type LeadTracking,
  type LeadTrackingDetail,
  type TrackingFilters,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { AdminPageLayout, HelpTip } from "@/components/admin-shell";
import { CrmTimeline } from "@/components/crm-timeline";
import { getCurrentStageDetail, getTrackingClientName, parseStageDetailDataInput, serializeStageDetailData } from "@/lib/crm-case";
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

type CrmViewMode = "board" | "list";

const STATUS_SUGGESTS_NOTES: Set<CrmStatus> = new Set(["rejected", "accepted", "validation"]);
const STATUS_SHOWS_CHANNEL:  Set<CrmStatus> = new Set(["contact"]);
const STATUS_SHOWS_REMINDER: Set<CrmStatus> = new Set(["observed"]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_FILTERS: TrackingFilters = {
  q: "",
  niche: "",
  source: "",
  contact_tier: "",
  status_in: "",
  created_after: "",
};

function filtersFromSearchParams(sp: URLSearchParams): TrackingFilters {
  return {
    q:             sp.get("q") ?? "",
    niche:         sp.get("niche") ?? "",
    source:        sp.get("source") ?? "",
    contact_tier:  sp.get("contact_tier") ?? "",
    status_in:     sp.get("status_in") ?? "",
    created_after: sp.get("created_after") ?? "",
  };
}

function hasActiveFilters(f: TrackingFilters): boolean {
  return !!(f.q || f.niche || f.source || f.contact_tier || f.status_in || f.created_after);
}

function buildApiFilters(f: TrackingFilters): TrackingFilters {
  const out: TrackingFilters = { limit: 300 };
  if (f.q) out.q = f.q;
  if (f.niche) out.niche = f.niche;
  if (f.source) out.source = f.source;
  if (f.contact_tier) out.contact_tier = f.contact_tier;
  if (f.status_in) out.status_in = f.status_in;
  if (f.created_after) out.created_after = f.created_after;
  return out;
}

export default function CrmBoardPage() {
  const token = useAuthStore((s) => s.token);
  const role   = useAuthStore((s) => s.role);
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [contactChannelPick, setContactChannelPick] = useState("whatsapp");
  // N65: keyeado por `${leadId}::${field}` — antes el estado de un caso contaminaba al
  // siguiente, y un fallo volvía a 'idle' silenciosamente (parecía no-hecho, no error).
  const [contactFeedback, setContactFeedback] = useState<Record<string, "idle" | "saving" | "done" | "error">>({});
  const [filters, setFilters]       = useState<TrackingFilters>(() => filtersFromSearchParams(searchParams));
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode]     = useState<CrmViewMode>((searchParams.get("view") === "list" ? "list" : "board"));
  const [detailTitleDraft, setDetailTitleDraft] = useState("");
  const [detailStageSummaryDraft, setDetailStageSummaryDraft] = useState("");
  const [detailStageDataDraft, setDetailStageDataDraft] = useState("{}");
  const [detailNoteDraft, setDetailNoteDraft] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailStageSummaryRef = useRef<HTMLTextAreaElement | null>(null);
  const detailStageDataRef = useRef<HTMLTextAreaElement | null>(null);

  const applyFilters = useCallback((f: TrackingFilters) => {
    const params = new URLSearchParams();
    if (viewMode === "list") params.set("view", "list");
    if (f.q) params.set("q", f.q);
    if (f.niche) params.set("niche", f.niche);
    if (f.source) params.set("source", f.source);
    if (f.contact_tier) params.set("contact_tier", f.contact_tier);
    if (f.status_in) params.set("status_in", f.status_in);
    if (f.created_after) params.set("created_after", f.created_after);
    router.replace(`?${params.toString()}`, { scroll: false });
    setFilters(f);
  }, [router, viewMode]);

  const updateViewMode = useCallback((nextViewMode: CrmViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextViewMode === "list") {
      params.set("view", "list");
    } else {
      params.delete("view");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
    setViewMode(nextViewMode);
  }, [router, searchParams]);

  const syncDetailDrafts = useCallback((detailData: LeadTrackingDetail | null) => {
    if (!detailData) {
      setDetailTitleDraft("");
      setDetailStageSummaryDraft("");
      setDetailStageDataDraft("{}");
      setDetailNoteDraft("");
      return;
    }

    const currentStageDetail = getCurrentStageDetail(detailData);
    setDetailTitleDraft(detailData.title);
    setDetailStageSummaryDraft(currentStageDetail?.summary ?? "");
    setDetailStageDataDraft(serializeStageDetailData(currentStageDetail?.data));
    setDetailNoteDraft("");
  }, []);

  const load = useCallback(async (f: TrackingFilters = {}) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listTrackings(token, buildApiFilters(f));
      setTrackings(res.data ?? []);
    } catch {
      setError("Error cargando seguimientos.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(filters); }, [load, filters]);

  const ownerFilterValid = ownerFilter && UUID_REGEX.test(ownerFilter);
  const visibleTrackings = role === "admin" && ownerFilterValid
    ? trackings.filter((tracking) => tracking.owner_id === ownerFilter)
    : trackings;
  const grouped = groupTrackingsByStatus(visibleTrackings);
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
      isRegression: isRegressionTransition(tracking.status, "observed"),
    });

  const openNote = (tracking: LeadTracking) =>
    setNoteModal({ tracking, notes: "" });

  const openDetail = async (trackingId: string) => {
    if (!token) return;
    setDetailError(null);
    setDetail({ trackingId, detail: null, loading: true });
    try {
      const res = await getTracking(token, trackingId);
      syncDetailDrafts(res.data);
      setDetail({ trackingId, detail: res.data, loading: false });
    } catch {
      setDetail({ trackingId, detail: null, loading: false });
    }
  };

  const refreshDetail = useCallback(async (trackingId: string) => {
    if (!token) return null;
    const res = await getTracking(token, trackingId);
    syncDetailDrafts(res.data);
    setDetail({ trackingId, detail: res.data, loading: false });
    return res.data;
  }, [syncDetailDrafts, token]);

  const closeAll = () => {
    setTransition(null);
    setNoteModal(null);
    setDetail(null);
    setSaveError(null);
    setDetailError(null);
  };

  const handleTransition = async () => {
    if (!token || !transition) return;
    setSaving(true);
    setSaveError(null);
    const shouldRefreshDetail = detail?.trackingId === transition.tracking.id;
    try {
      await transitionTracking(token, transition.tracking.id, {
        to_status:   transition.to_status,
        notes:       transition.notes || undefined,
        channel:     transition.channel || undefined,
        reminder_at: transition.reminder_at || undefined,
      });
      setTransition(null);
      setSaveError(null);
      await load(filters);
      if (shouldRefreshDetail) {
        await refreshDetail(transition.tracking.id);
      }
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
    const shouldRefreshDetail = detail?.trackingId === noteModal.tracking.id;
    try {
      await addTrackingNote(token, noteModal.tracking.id, noteModal.notes.trim());
      setNoteModal(null);
      setSaveError(null);
      if (shouldRefreshDetail) {
        await refreshDetail(noteModal.tracking.id);
      }
      await load(filters);
    } catch {
      setSaveError("Error al guardar la nota.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetailTitle = async () => {
    if (!token || !detail?.detail || !detailTitleDraft.trim()) return;
    setSaving(true);
    setDetailError(null);
    try {
      await updateTrackingTitle(token, detail.detail.id, detailTitleDraft.trim());
      await refreshDetail(detail.detail.id);
      await load(filters);
    } catch {
      setDetailError("Error al guardar el título del CRM.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStageDetail = async () => {
    if (!token || !detail?.detail) return;
    const liveSummary = detailStageSummaryRef.current?.value ?? detailStageSummaryDraft;
    const liveData = detailStageDataRef.current?.value ?? detailStageDataDraft;
    const parsed = parseStageDetailDataInput(liveData);
    if (parsed.error) {
      setDetailError(parsed.error);
      return;
    }

    setSaving(true);
    setDetailError(null);
    try {
      await upsertTrackingStageDetails(token, detail.detail.id, {
        stage: detail.detail.status,
        summary: liveSummary.trim() || null,
        data: parsed.data,
      });
      await refreshDetail(detail.detail.id);
      await load(filters);
    } catch {
      setDetailError("Error al guardar la información de la etapa actual.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetailNote = async () => {
    if (!token || !detail?.detail || !detailNoteDraft.trim()) return;
    setSaving(true);
    setDetailError(null);
    try {
      await addTrackingNote(token, detail.detail.id, detailNoteDraft.trim());
      await refreshDetail(detail.detail.id);
      await load(filters);
      setDetailNoteDraft("");
    } catch {
      setDetailError("Error al guardar el comentario manual.");
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
      await load(filters);
    }
  };

  const draggingTracking = draggingId ? trackings.find((t) => t.id === draggingId) : null;

  return (
    <AdminPageLayout
      title="CRM — Seguimiento comercial"
      description="Board y lista unificados sobre el mismo caso CRM"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => updateViewMode("board")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "board" ? "bg-slate-900 text-white" : "theme-text-muted hover:bg-slate-50"
              )}
            >
              Board
            </button>
            <button
              type="button"
              onClick={() => updateViewMode("list")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-slate-900 text-white" : "theme-text-muted hover:bg-slate-50"
              )}
            >
              Lista
            </button>
          </div>
          {role === "admin" ? (
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
          ) : null}
        </div>
      }
    >
      <HelpTip label="CRM">
        Usá `Board` para mover casos por etapa y `Lista` para revisar ID global, cliente y estado en una sola grilla. El popup del CRM centraliza historial, comentarios manuales, edición del título y datos de la etapa actual.
      </HelpTip>

      {/* Filter bar */}
      <div className="theme-panel rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                showFilters ? "bg-sky-50 border-sky-200 text-sky-700" : "theme-text-muted hover:bg-slate-50"
              )}
            >
              {showFilters ? "Ocultar filtros" : "Filtros"}
              {hasActiveFilters(filters) && !showFilters && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                  {[filters.q, filters.niche, filters.source, filters.contact_tier, filters.status_in, filters.created_after].filter(Boolean).length}
                </span>
              )}
            </button>
            {hasActiveFilters(filters) && (
              <button
                type="button"
                onClick={() => applyFilters(EMPTY_FILTERS)}
                className="text-xs text-rose-600 hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <span className="text-xs theme-text-muted">{visibleTrackings.length} seguimiento{visibleTrackings.length !== 1 ? "s" : ""}</span>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Texto libre (ID, título o cliente)</label>
              <input
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                placeholder="CRM-000123, título o cliente…"
                value={filters.q ?? ""}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Rubro (niche)</label>
              <input
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                placeholder="ej: restaurante"
                value={filters.niche ?? ""}
                onChange={(e) => setFilters({ ...filters, niche: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Fuente (source)</label>
              <input
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                placeholder="ej: google_places"
                value={filters.source ?? ""}
                onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Tier de contacto</label>
              <input
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                placeholder="ej: hot"
                value={filters.contact_tier ?? ""}
                onChange={(e) => setFilters({ ...filters, contact_tier: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Estados (separados por ,)</label>
              <input
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                placeholder="ej: contact,observed"
                value={filters.status_in ?? ""}
                onChange={(e) => setFilters({ ...filters, status_in: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div>
              <label className="text-[10px] theme-text-muted block mb-1">Creados desde</label>
              <input
                type="date"
                className="w-full rounded-lg border px-2 py-1 text-xs theme-input"
                value={filters.created_after ? filters.created_after.slice(0, 10) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setFilters({ ...filters, created_after: v ? `${v}T00:00:00.000Z` : "" });
                }}
                onKeyDown={(e) => e.key === "Enter" && applyFilters(filters)}
              />
            </div>
            <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex justify-end">
              <button
                type="button"
                onClick={() => applyFilters(filters)}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
          {error}
        </div>
      )}

      {loading && !trackings.length && (
        <div className="text-sm theme-text-muted py-8 text-center">Cargando…</div>
      )}

      {viewMode === "board" ? (
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
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", color)}>{label}</span>
                    <span className="text-xs font-medium theme-text-muted">{cards.length}</span>
                  </div>
                  <div className="min-h-[60px] space-y-2">
                    {cards.length === 0 && (
                      <div className="rounded-xl border border-dashed px-3 py-4 text-center text-xs theme-text-muted">
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
      ) : (
        <CrmListView
          trackings={visibleTrackings}
          isAdmin={role === "admin"}
          onOpenDetail={(trackingId) => openDetail(trackingId)}
        />
      )}

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
              {transition.tracking.case_code} · {transition.tracking.title}
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
                {detail.detail?.case_code ?? "CRM"} · {detail.detail?.title ?? detail.detail?.lead?.name ?? detail.detail?.lead_name ?? "Seguimiento"}
              </h2>
              <button className="text-xs theme-text-muted hover:underline ml-4 shrink-0" onClick={closeAll}>Cerrar</button>
            </div>
            {detail.loading && <p className="text-sm theme-text-muted">Cargando…</p>}
            {!detail.loading && !detail.detail && (
              <p className="text-sm text-rose-600">No se pudo cargar el detalle.</p>
            )}
            {detail.detail && (
              <>
                <div className="mb-4 rounded-xl border px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] theme-text-muted">Caso CRM</p>
                      <p className="mt-1 text-xs theme-text-muted">ID global visible y buscable del caso.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">{detail.detail.case_code}</span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div>
                      <label className="mb-1 block text-[10px] theme-text-muted">Título editable</label>
                      <input
                        className="w-full rounded-lg border px-3 py-2 text-sm theme-input"
                        value={detailTitleDraft}
                        onChange={(e) => setDetailTitleDraft(e.target.value)}
                        placeholder="Título del CRM"
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      onClick={() => void handleSaveDetailTitle()}
                      disabled={saving || !detailTitleDraft.trim() || detailTitleDraft.trim() === detail.detail.title}
                    >
                      {saving ? "Guardando…" : "Guardar título"}
                    </button>
                  </div>
                </div>

                {/* Lead data */}
                <div className="rounded-xl border px-3 py-3 mb-4 space-y-2 text-xs theme-text-muted">
                  <p>Cliente: <span className="theme-text-strong">{getTrackingClientName(detail.detail)}</span></p>
                  {detail.detail.lead?.niche && (
                    <p>Rubro: <span className="theme-text-strong">{detail.detail.lead.niche}</span></p>
                  )}
                  {detail.detail.lead?.address && (
                    <p>Dirección: <span className="theme-text-strong">{detail.detail.lead.address}</span></p>
                  )}
                  <div className="space-y-1.5">
                    {detail.detail.lead?.whatsapp && detail.detail.lead.whatsapp !== "***" && (
                      <ContactChannelRow
                        label="WhatsApp"
                        value={detail.detail.lead.whatsapp}
                        href={`https://wa.me/${detail.detail.lead.whatsapp.replace(/\D/g, "")}`}
                        actionLabel="Abrir"
                        fieldKey="whatsapp"
                        leadId={detail.detail.lead_id}
                        feedbackState={contactFeedback[`${detail.detail.lead_id}::whatsapp`] ?? "idle"}
                        onFeedback={(verdict) => {
                          setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::whatsapp`]: "saving" }));
                          createLeadFeedback(token!, detail.detail!.lead_id, { field_key: "whatsapp", field_value: detail.detail!.lead?.whatsapp ?? undefined, verdict })
                            .then(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::whatsapp`]: "done" })))
                            .catch(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::whatsapp`]: "error" })));
                        }}
                      />
                    )}
                    {detail.detail.lead?.phone && detail.detail.lead.phone !== "***" && (
                      <ContactChannelRow
                        label="Teléfono"
                        value={detail.detail.lead.phone}
                        href={`tel:${detail.detail.lead.phone.replace(/[^\d+]/g, "")}`}
                        actionLabel="Llamar"
                        fieldKey="phone"
                        leadId={detail.detail.lead_id}
                        feedbackState={contactFeedback[`${detail.detail.lead_id}::phone`] ?? "idle"}
                        onFeedback={(verdict) => {
                          setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::phone`]: "saving" }));
                          createLeadFeedback(token!, detail.detail!.lead_id, { field_key: "phone", field_value: detail.detail!.lead?.phone ?? undefined, verdict })
                            .then(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::phone`]: "done" })))
                            .catch(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::phone`]: "error" })));
                        }}
                      />
                    )}
                    {detail.detail.lead?.email && detail.detail.lead.email !== "***" && (
                      <ContactChannelRow
                        label="Email"
                        value={detail.detail.lead.email}
                        href={`mailto:${detail.detail.lead.email}`}
                        actionLabel="Enviar"
                        fieldKey="email"
                        leadId={detail.detail.lead_id}
                        feedbackState={contactFeedback[`${detail.detail.lead_id}::email`] ?? "idle"}
                        onFeedback={(verdict) => {
                          setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::email`]: "saving" }));
                          createLeadFeedback(token!, detail.detail!.lead_id, { field_key: "email", field_value: detail.detail!.lead?.email ?? undefined, verdict })
                            .then(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::email`]: "done" })))
                            .catch(() => setContactFeedback((prev) => ({ ...prev, [`${detail.detail!.lead_id}::email`]: "error" })));
                        }}
                      />
                    )}
                    {detail.detail.lead?.website && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 w-16 shrink-0">Web</span>
                        <a href={detail.detail.lead.website.startsWith("http") ? detail.detail.lead.website : `https://${detail.detail.lead.website}`} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline truncate">{detail.detail.lead.website}</a>
                      </div>
                    )}
                  </div>
                  <p className="pt-1">
                    <Link href={`/admin/leads/${detail.detail.lead_id}`} className="text-sky-600 hover:underline">
                      Ver ficha completa →
                    </Link>
                  </p>
                </div>

                <div className="mb-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted">Comentario manual</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">no cambia estado</span>
                    </div>
                    <textarea
                      className="min-h-28 w-full rounded-lg border px-3 py-2 text-sm theme-input resize-y"
                      rows={4}
                      placeholder="Agregar contexto comercial, próximos pasos o aclaraciones del caso…"
                      value={detailNoteDraft}
                      onChange={(e) => setDetailNoteDraft(e.target.value)}
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                        onClick={() => void handleSaveDetailNote()}
                        disabled={saving || !detailNoteDraft.trim()}
                      >
                        {saving ? "Guardando…" : "Guardar comentario"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted">Etapa actual</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">{detail.detail.status}</span>
                    </div>
                    <label className="mb-1 block text-[10px] theme-text-muted">Resumen de etapa</label>
                    <textarea
                      ref={detailStageSummaryRef}
                      className="w-full rounded-lg border px-3 py-2 text-sm theme-input resize-y"
                      rows={3}
                      placeholder="Qué pasó en esta etapa, bloqueo actual, owner next step…"
                      value={detailStageSummaryDraft}
                      onChange={(e) => setDetailStageSummaryDraft(e.target.value)}
                    />
                    <label className="mb-1 mt-3 block text-[10px] theme-text-muted">Datos avanzados JSON</label>
                    <textarea
                      ref={detailStageDataRef}
                      className="min-h-28 w-full rounded-lg border px-3 py-2 font-mono text-xs theme-input resize-y"
                      rows={6}
                      placeholder='{"owner_note":"..."}'
                      value={detailStageDataDraft}
                      onChange={(e) => setDetailStageDataDraft(e.target.value)}
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        onClick={() => void handleSaveStageDetail()}
                        disabled={saving}
                      >
                        {saving ? "Guardando…" : "Guardar etapa actual"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Channel picker — only when in contact stage */}
                {detail.detail.status === "contact" && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 mb-2">¿Qué canal usaste?</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(["whatsapp", "phone", "email"] as const).map((ch) => (
                        <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="contact-channel"
                            value={ch}
                            checked={contactChannelPick === ch}
                            onChange={() => setContactChannelPick(ch)}
                            className="accent-sky-600"
                          />
                          <span className="text-xs font-medium text-sky-800 capitalize">
                            {ch === "whatsapp" ? "WhatsApp" : ch === "phone" ? "Teléfono" : "Email"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const tracking = trackings.find((t) => t.id === detail.trackingId);
                        if (tracking) {
                          closeAll();
                          setTransition({ tracking, to_status: "validation", notes: "", channel: contactChannelPick, reminder_at: "", isRegression: isRegressionTransition(tracking.status, "validation") });
                        }
                      }}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                    >
                      Marcar como contactado → validation
                    </button>
                  </div>
                )}

                {/* Events timeline */}
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted mb-3">
                    Historial ({detail.detail.events.length})
                  </p>
                  <CrmTimeline events={detail.detail.events} />
                </div>

                {detail.detail.stage_details.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted mb-3">
                      Información por etapa ({detail.detail.stage_details.length})
                    </p>
                    <div className="space-y-2">
                      {detail.detail.stage_details.map((stageDetail) => (
                        <div key={stageDetail.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold capitalize text-slate-900">{stageDetail.stage}</span>
                            <span>{formatRelative(stageDetail.updated_at)}</span>
                          </div>
                          {stageDetail.summary ? <p className="mt-2 text-sm text-slate-800">{stageDetail.summary}</p> : null}
                          {Object.keys(stageDetail.data ?? {}).length > 0 ? (
                            <pre className="mt-2 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-600">{JSON.stringify(stageDetail.data, null, 2)}</pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
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
                              if (tracking) {
                                setDetailError(null);
                                openTransition(tracking, to);
                              }
                            }}
                          >
                            {isRegression || isReopen ? `← ${to}` : `→ ${to}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {detailError && <p className="text-xs text-rose-600">{detailError}</p>}
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
  const clientName = getTrackingClientName(tracking);

  return (
    <div className={cn("theme-panel rounded-xl border p-3 text-xs space-y-1.5", isDragging && "shadow-xl")}>
      <p className="font-mono text-[10px] text-slate-500">{tracking.case_code}</p>
      <button
        className="block w-full text-left font-medium theme-text-strong hover:underline truncate"
        onClick={onOpenDetail}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {tracking.title}
      </button>
      <p className="truncate theme-text-muted">Cliente: {clientName}</p>
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
        <button
          className="rounded px-1.5 py-0.5 text-[10px] border theme-text-muted hover:bg-slate-100"
          onClick={onAddNote}
        >
          + nota
        </button>
      </div>
    </div>
  );
}

function CrmListView({
  trackings,
  isAdmin,
  onOpenDetail,
}: {
  trackings: LeadTracking[];
  isAdmin: boolean;
  onOpenDetail: (trackingId: string) => void;
}) {
  return (
    <div className="theme-panel overflow-hidden rounded-2xl border">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">CRM</th>
              <th className="px-4 py-3 font-semibold">Título</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Etapa</th>
              <th className="px-4 py-3 font-semibold">Inicio</th>
              {isAdmin ? <th className="px-4 py-3 font-semibold">Owner</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {trackings.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-4 py-8 text-center text-sm theme-text-muted">
                  No hay casos para mostrar con los filtros actuales.
                </td>
              </tr>
            ) : (
              trackings.map((tracking) => {
                const statusMeta = CRM_COLUMNS.find((column) => column.status === tracking.status);
                return (
                  <tr
                    key={tracking.id}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                    onClick={() => onOpenDetail(tracking.id)}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs text-slate-500">{tracking.case_code}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        className="max-w-[24rem] truncate text-left font-medium theme-text-strong hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenDetail(tracking.id);
                        }}
                      >
                        {tracking.title}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top theme-text-muted">{getTrackingClientName(tracking)}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", statusMeta?.color)}>
                        {statusMeta?.label ?? tracking.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top theme-text-muted">{formatRelative(tracking.started_at)}</td>
                    {isAdmin ? <td className="px-4 py-3 align-top theme-text-muted">{tracking.owner_id.slice(0, 8)}…</td> : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContactChannelRow({
  label,
  value,
  href,
  actionLabel,
  feedbackState,
  onFeedback,
}: {
  label: string;
  value: string;
  href: string;
  actionLabel: string;
  fieldKey: string;
  leadId: string;
  feedbackState: "idle" | "saving" | "done" | "error";
  onFeedback: (verdict: "good" | "bad") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-slate-700 w-16 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 truncate text-slate-800">{value}</span>
      <a
        href={href}
        target={href.startsWith("tel:") || href.startsWith("mailto:") ? undefined : "_blank"}
        rel={href.startsWith("tel:") || href.startsWith("mailto:") ? undefined : "noreferrer"}
        className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-700 shrink-0"
      >
        {actionLabel}
      </a>
      {feedbackState === "done" ? (
        <span className="text-emerald-600 text-xs shrink-0">✓</span>
      ) : (
        <>
          {/* N65: el fallo se muestra (antes volvía a idle y el voto se perdía en silencio) */}
          {feedbackState === "error" && (
            <span className="text-rose-600 text-[11px] shrink-0" title="No se pudo guardar — reintentá">⚠ reintentar</span>
          )}
          <button type="button" title="Dato correcto" disabled={feedbackState === "saving"} onClick={() => onFeedback("good")} className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40 shrink-0">👍</button>
          <button type="button" title="Dato incorrecto" disabled={feedbackState === "saving"} onClick={() => onFeedback("bad")} className="text-rose-500 hover:text-rose-700 disabled:opacity-40 shrink-0">👎</button>
        </>
      )}
    </div>
  );
}
