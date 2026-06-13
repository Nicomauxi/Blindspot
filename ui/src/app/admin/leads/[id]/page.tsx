"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  createLeadFeedback,
  createTracking,
  generateLeadBrief,
  generateOffer,
  getLead,
  getOwnerGroup,
  getSocialHistory,
  updateFavoriteContacts,
  searchLeadsByName,
  listOutreach,
  type LeadAssistantBrief,
  type SocialHistoryPlatform,
  type LeadDetail,
  type LeadFieldSource,
  type OfferPackage,
  type OutreachEntry,
  type OwnerGroupMember,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { contactReadyCopy } from "@/lib/contact-ready";
import { cn, formatRelative } from "@/lib/utils";
import { AdminPageLayout, EmptyPanel, HelpTip, SectionCard, StatCard } from "@/components/admin-shell";
import { CollapsibleSection } from "@/components/collapsible-section";
import { CommercialSummary } from "@/components/lead/commercial-summary";
import {
  ContactBlock,
  type ContactPoint,
  type ContactSocialActivity,
  type ContactLiveness,
  type FeedbackPayload,
} from "@/components/lead/contact-block";

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-sky-100 text-sky-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-slate-100 text-slate-700",
  X: "bg-rose-100 text-rose-700",
};

const OUTREACH_STATUS_COLORS: Record<string, string> = {
  sent: "bg-sky-50 text-sky-700",
  responded: "bg-violet-50 text-violet-700",
  interested: "bg-amber-50 text-amber-700",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-rose-50 text-rose-700",
  no_response: "bg-slate-50 text-slate-600",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  phone: "Teléfono",
  contacto_directo: "Contacto directo",
};

type ContactPointKind = ContactPoint["kind"];

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 160;
  const h = 36;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SocialGrowthChart({ leadId }: { leadId: string }) {
  const token = useAuthStore((s) => s.token);
  const [platforms, setPlatforms] = useState<Record<string, SocialHistoryPlatform> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;
    getSocialHistory(token, leadId)
      .then((res) => {
        if (active) setPlatforms(res.data.platforms);
      })
      .catch(() => {
        if (active) setPlatforms({});
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, leadId]);

  if (loading) return null;
  const entries = Object.entries(platforms ?? {});
  const withSeries = entries.filter(([, p]) => p.point_count > 0);

  if (withSeries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        📈 Crecimiento de seguidores: empezamos a medir. La gráfica aparece tras la próxima medición.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Crecimiento de seguidores</div>
      {withSeries.map(([platform, p]) => {
        const followers = p.series.map((s) => s.followers).filter((v): v is number => v != null);
        const growth = p.followers_growth_30d;
        return (
          <div key={platform} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-medium capitalize text-slate-700">{platform}</span>
              {growth ? (
                <span className={cn("text-xs font-semibold", growth.abs >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {growth.abs >= 0 ? "+" : ""}{growth.abs.toLocaleString("es-UY")}
                  {growth.pct != null ? ` (${growth.pct >= 0 ? "+" : ""}${growth.pct}%)` : ""} en ~30d
                </span>
              ) : p.point_count < 2 ? (
                <span className="text-xs text-slate-400">1 medición — sin tendencia aún</span>
              ) : (
                <span className="text-xs text-slate-400">sin datos de ventana</span>
              )}
              {p.posts_per_month != null ? (
                <span className="text-[11px] text-slate-500">{p.posts_per_month} posts/mes</span>
              ) : null}
              {p.churn_risk ? <span className="text-[11px] font-semibold text-amber-600">⚠ Riesgo de abandono</span> : null}
            </div>
            <Sparkline values={followers} />
          </div>
        );
      })}
    </div>
  );
}

function formatSectionError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError) {
    if (error.error_code === "assistant_unavailable") {
      return "No se pudo generar el resumen asistido. Segui con la evidencia del lead o genera un mensaje manual.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallbackMessage;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const router = useRouter();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [outreach, setOutreach] = useState<OutreachEntry[]>([]);
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferPackage | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerChannel, setOfferChannel] = useState("whatsapp");
  const [assistant, setAssistant] = useState<LeadAssistantBrief | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [startingTracking, setStartingTracking] = useState(false);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    Promise.all([
      getLead(token, id),
      listOutreach(token, { lead_id: id, limit: 20 }),
      getOwnerGroup(token, id),
    ])
      .then(([leadRes, outreachRes, ownerGroupRes]) => {
        setLead(leadRes.data);
        setOutreach(outreachRes.data);
        setOwnerGroup(ownerGroupRes.data ?? []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar lead"))
      .finally(() => setLoading(false));
  }, [token, id]);

  useEffect(() => {
    if (!token || !id || !lead) return;
    // N66: cm pre-tracking → el endpoint 403ea siempre; la UI ya sabe que el lead
    // está redactado y se ahorra la llamada garantizada e inútil.
    const redacted = lead.phone === "***" || lead.email === "***" || lead.whatsapp === "***";
    if (redacted) {
      setAssistant(null);
      setAssistantError(null);
      return;
    }
    setAssistantLoading(true);
    setAssistantError(null);
    generateLeadBrief(token, id)
      .then((res) => {
        setAssistant(res.data);
        setAssistantError(null);
      })
      .catch((err) => {
        setAssistant(null);
        setAssistantError(
          formatSectionError(err, "No se pudo generar el resumen asistido para este lead.")
        );
      })
      .finally(() => setAssistantLoading(false));
  }, [id, lead?.id, token]);

  const fieldSources = lead?.field_sources ?? {};
  const evidenceTree = lead?.commercial_evidence_tree ?? [];
  const scoreBreakdown = lead?.score_breakdown ?? null;
  const inferredState = lead?.inferred_state ?? null;
  const digitalFootprint = lead?.digital_footprint ?? null;
  const companyData = lead?.lead_company_data ?? null;
  const canonicalFields = lead?.canonical_fields ?? null;

  const actionChecklist = useMemo(() => {
    if (!lead) return [];
    return [
      { label: "Hay un pitch de entrada claro", done: Boolean(lead.pitch_hook || assistant?.personalized_pitch) },
      { label: "Existe al menos un canal usable", done: Boolean((lead.whatsapp && lead.whatsapp !== "***") || (lead.email && lead.email !== "***") || (lead.phone && lead.phone !== "***")) },
      { label: "El contacto parece listo", done: lead.contact_ready === true },
      { label: "Ya se revisó historial de acciones", done: outreach.length > 0 },
      { label: "Se validó si comparte owner group", done: ownerGroup.length > 0 || !lead.owner_group_id },
    ];
  }, [assistant?.personalized_pitch, lead, outreach.length, ownerGroup.length]);

  const contactPoints = useMemo(() => buildContactPoints(lead), [lead]);

  async function handleContactFeedback(payload: FeedbackPayload) {
    if (!token || !lead) return;
    await createLeadFeedback(token, lead.id, {
      field_key: payload.fieldKey,
      field_value: payload.value,
      verdict: payload.verdict,
      comment: payload.comment?.trim() || undefined,
      rejection_reason: payload.rejectionReason,
      reassign_to_lead_id: payload.reassignToLeadId,
    });
  }

  async function handleToggleFavorite(point: ContactPoint, next: boolean) {
    if (!token || !lead) return;
    const current = contactPoints.filter((p) => p.favorite).map((p) => ({ kind: p.kind, value: p.value }));
    const key = (k: string, v: string) => `${k}::${v.trim().toLowerCase()}`;
    const nextFavorites = next
      ? [...current, { kind: point.kind, value: point.value }]
      : current.filter((f) => key(f.kind, f.value) !== key(point.kind, point.value));
    // Dedup
    const seen = new Set<string>();
    const deduped = nextFavorites.filter((f) => {
      const k = key(f.kind, f.value);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    try {
      await updateFavoriteContacts(token, lead.id, deduped);
      const refreshed = await getLead(token, lead.id);
      setLead(refreshed.data);
    } catch (err) {
      setError(formatSectionError(err, "No se pudo actualizar el favorito."));
    }
  }

  const handleSearchLeads = useCallback(
    async (query: string) => {
      if (!token) return [];
      return searchLeadsByName(token, query);
    },
    [token]
  );

  async function handleGenerateOffer() {
    if (!token || !lead) return;
    setOfferLoading(true);
    setOffer(null);
    setOfferError(null);
    try {
      const res = await generateOffer(token, { lead_id: lead.id, channel: offerChannel });
      setOffer(res.data);
      setOfferError(null);
    } catch (err) {
      setOfferError(
        formatSectionError(err, "No se pudo generar un mensaje alternativo para este lead.")
      );
    } finally {
      setOfferLoading(false);
    }
  }

  const isContactRedacted = Boolean(
    lead && (lead.phone === "***" || lead.email === "***" || lead.whatsapp === "***")
  );

  async function handleStartTracking() {
    if (!token || !lead) return;
    setStartingTracking(true);
    setTrackingNotice(null);
    try {
      await createTracking(token, { lead_id: lead.id });
      if (isContactRedacted) {
        // Reload lead to show unredacted contact data
        const refreshed = await getLead(token, lead.id);
        setLead(refreshed.data);
        setTrackingNotice("Seguimiento iniciado. Datos de contacto desbloqueados.");
      } else {
        setTrackingNotice("Seguimiento iniciado.");
        router.push("/admin/crm");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const refreshed = await getLead(token, lead.id);
          setLead(refreshed.data);
          const unlocked = refreshed.data.phone !== "***" || refreshed.data.email !== "***" || refreshed.data.whatsapp !== "***";
          setTrackingNotice(
            unlocked
              ? "Ya existía un seguimiento activo para este lead. Refrescamos la ficha y desbloqueamos el contacto."
              : "Ya existe un seguimiento activo para este lead. Buscalo en el board de CRM."
          );
        } catch {
          setTrackingNotice("Ya existe un seguimiento activo para este lead. Buscalo en el board de CRM.");
        }
      } else {
        setTrackingNotice("No se pudo iniciar el seguimiento. Intentá de nuevo.");
      }
    } finally {
      setStartingTracking(false);
    }
  }

  function copyText(key: string, value: string | null | undefined) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    }).catch(() => {});
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">Cargando ficha…</div>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  if (!lead) return null;

  // N68: sin brief del asistente (cm pre-tracking → 403), el canal se deriva del
  // primer contacto VIVO del lead — el fallback al selector de mensajes decía
  // 'WhatsApp' para miles de leads sin WhatsApp.
  const hasValue = (value: string | null | undefined) => Boolean(value && value !== "***");
  const derivedChannel = hasValue(lead.whatsapp) ? "whatsapp" : hasValue(lead.phone) ? "phone" : hasValue(lead.email) ? "email" : null;
  const recommendedChannelLabel =
    CHANNEL_LABELS[assistant?.recommended_channel ?? ""] ??
    (derivedChannel ? CHANNEL_LABELS[derivedChannel] : undefined) ??
    "Canal no definido";

  return (
    <AdminPageLayout
      eyebrow="Lead"
      title={lead.name}
      description="Vista pitch-first con contexto comercial, trazabilidad de cada dato y acceso completo al registro del lead."
      actions={
        <>
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            Volver
          </button>
          <button
            type="button"
            onClick={handleStartTracking}
            disabled={startingTracking}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {startingTracking ? "Iniciando…" : "Iniciar seguimiento"}
          </button>
        </>
      }
    >
      {/* 1. Header stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Prospect score" value={lead.prospect_score ?? "—"} hint="Prioridad comercial relativa" tone="good" />
        <StatCard label="Oferta sugerida" value={lead.primary_offer ?? "—"} hint={lead.pitch_hook ?? "Sin pitch hook sugerido"} tone="info" />
        <StatCard label="Canal recomendado" value={recommendedChannelLabel} hint={contactReadyCopy(lead.contact_ready).hint} />
        <StatCard label="Fuentes disponibles" value={lead.sources_count ?? lead.corroborating_sources.length ?? 0} hint={lead.canonical_source ? `Fuente principal: ${lead.canonical_source}` : "Sin canonical_source"} />
        <StatCard label="Tier / Estado" value={`${lead.contact_tier ?? "—"} · ${lead.state}`} hint={lead.business_status ?? "Sin estado comercial"} />
      </div>

      {/* RBAC-1: contact unlock banner for cm users */}
      {role === "cm" && isContactRedacted && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-800">Datos de contacto ocultos</p>
            <p className="mt-0.5 text-xs text-amber-700">
              Iniciá el seguimiento de este lead para desbloquear teléfono, WhatsApp y email.
            </p>
          </div>
          <button
            onClick={handleStartTracking}
            disabled={startingTracking}
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {startingTracking ? "Iniciando…" : "Iniciar seguimiento para ver contacto"}
          </button>
        </div>
      )}

      {trackingNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {trackingNotice}
        </div>
      )}

      {/* 2. Análisis comercial — full width */}
      <SectionCard title="Análisis comercial" description="Ofertas sugeridas, evidencia por oferta y lectura asistida para abrir conversación.">
        <CommercialSummary offerings={lead.commercial_offerings ?? null} leadName={lead.name} evidenceTree={evidenceTree} />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lectura rápida</div>
              {assistantLoading ? (
                <div className="mt-3 space-y-2 animate-pulse">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="h-4 w-full rounded bg-slate-100" />
                  <div className="h-4 w-5/6 rounded bg-slate-100" />
                </div>
              ) : assistant ? (
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  <p className="text-base font-semibold text-slate-900">{assistant.summary}</p>
                  <p>{assistant.why_it_matters}</p>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pitch de entrada</div>
                    <p className="mt-1">{assistant.personalized_pitch}</p>
                  </div>
                </div>
              ) : (
                <>
                  {lead.pitch_hook ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-900">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pitch de entrada</div>
                      <p className="mt-1 text-sm">{lead.pitch_hook}</p>
                    </div>
                  ) : null}
                  <EmptyPanel
                    title="Sin resumen asistido"
                    description={assistantError ?? "La ficha sigue disponible con todos los datos y su trazabilidad."}
                  />
                </>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SourceFieldCard label="Oferta sugerida" value={lead.primary_offer} trace={fieldSources.primary_offer} help="Oferta prioritaria para abrir conversación." />
              <SourceFieldCard label="Pitch hook" value={lead.pitch_hook} trace={fieldSources.pitch_hook} help="Frase o hallazgo que justifica el primer mensaje." />
              <SourceFieldCard label="Buyer probable" value={lead.top_buyer_type} trace={fieldSources.top_buyer_type} />
              <SourceFieldCard label="Urgencia" value={lead.urgency_signal} trace={fieldSources.urgency_signal} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Qué hacer ahora</div>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <div>
                  <div className="font-medium text-slate-900">Siguiente paso sugerido</div>
                  <p className="mt-1">{assistant?.next_step ?? "Revisá la evidencia y definí el canal de salida."}</p>
                </div>
                <div>
                  <div className="font-medium text-slate-900">Canal recomendado</div>
                  <p className="mt-1">{recommendedChannelLabel}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="font-medium text-slate-900">Checklist previo</div>
                  <div className="mt-3 space-y-2">
                    {actionChecklist.map((item) => (
                      <div key={item.label} className="flex items-start gap-2 text-sm">
                        <span className={cn("mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", item.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>{item.done ? "✓" : "•"}</span>
                        <span className={item.done ? "text-slate-700" : "text-slate-500"}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Estado operativo</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={cn("rounded-full px-2.5 py-1 font-semibold", lead.contact_tier ? TIER_COLORS[lead.contact_tier] ?? "bg-slate-700 text-white" : "bg-slate-800 text-slate-200")}>Tier {lead.contact_tier ?? "—"}</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1">{lead.state}</span>
                {lead.business_status ? <span className="rounded-full bg-white/10 px-2.5 py-1">{lead.business_status}</span> : null}
                {lead.contact_ready != null ? <span className="rounded-full bg-white/10 px-2.5 py-1">{lead.contact_ready ? "Contacto listo" : "Validar contacto"}</span> : null}
              </div>
              {lead.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* 3. Contactos y Redes — master-detail con actividad social integrada */}
      <SectionCard title="Contactos y Redes" description="Elegí un contacto o red para ver su desglose, actividad y acciones.">
        <ContactBlock
          points={contactPoints}
          leadId={lead.id}
          onFeedback={handleContactFeedback}
          onToggleFavorite={handleToggleFavorite}
          onSearchLeads={handleSearchLeads}
        />
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Datos de contacto</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SourceFieldCard label="Contacto listo" value={formatBoolean(lead.contact_ready)} trace={fieldSources.contact_ready} />
              <SourceFieldCard label="Tier de contacto" value={lead.contact_tier} trace={fieldSources.contact_tier} />
              <SourceFieldCard label="Fuente principal" value={lead.canonical_source ?? lead.source} trace={fieldSources.name} help="Usamos la misma base de evidencia que respalda el registro principal del lead." />
            </div>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Lectura del negocio</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SourceFieldCard label="Rubro" value={lead.niche} trace={fieldSources.niche} />
              <SourceFieldCard label="Estado comercial" value={lead.business_status} trace={fieldSources.business_status} />
              <SourceFieldCard label="Rating" value={lead.rating != null ? `${lead.rating} ★` : null} trace={fieldSources.rating} />
              <SourceFieldCard label="Reseñas" value={lead.review_count} trace={fieldSources.review_count} />
              <SimpleFieldCard label="Confiabilidad contacto" value={formatPercent(lead.contact_reliability_score)} />
              <SimpleFieldCard label="Creado" value={lead.created_at ? formatRelative(lead.created_at) : "—"} />
            </div>
          </div>
        </div>
        <div className="mt-6">
          <SocialGrowthChart leadId={lead.id} />
        </div>
      </SectionCard>


      {/* 4. Historial de seguimiento (si existe) */}
      {outreach.length > 0 ? (
        <CollapsibleSection
          title="Historial de seguimiento"
          description={`${outreach.length} acciones registradas`}
          defaultOpen={false}
          storageKey={`lead-history-${id}`}
        >
          <div className="space-y-2">
            {outreach.map((entry) => (
              <OutreachRow key={entry.id} entry={entry} />
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* 5. Diagnóstico técnico — collapsible, cerrado por defecto */}
      <CollapsibleSection
        title="Diagnóstico técnico"
        description="Enriquecimiento, mensaje alternativo y datos completos del registro"
        defaultOpen={false}
        storageKey={`lead-diagnostico-${id}`}
      >
        <div className="space-y-4">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Generar mensaje alternativo</div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="offer-channel" className="sr-only">Canal de mensaje</label>
              <select id="offer-channel" value={offerChannel} onChange={(event) => setOfferChannel(event.target.value)} disabled={offerLoading} className="rounded-lg border border-slate-300 px-2 py-2 text-sm disabled:opacity-50">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="phone">Teléfono</option>
              </select>
              <button type="button" onClick={() => void handleGenerateOffer()} disabled={offerLoading} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {offerLoading ? "Generando…" : "Generar mensaje"}
              </button>
            </div>
            {offer ? (
              <CopyPanel title="Mensaje generado" body={offer.text} copyKey="offer" copiedKey={copiedKey} onCopy={copyText} footer={<span className="text-xs text-slate-400">{offer.provider ?? offer.source_llm}</span>} />
            ) : offerError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">{offerError}</div>
            ) : (
              <p className="text-sm text-slate-500">Elegí un canal y generá una alternativa lista para copiar.</p>
            )}
          </div>

          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Datos completos del lead</div>
            <div className="space-y-3">
              <StructuredSection title="Resumen de registro" defaultOpen>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <SimpleFieldCard label="Nombre" value={lead.name} />
                  <SimpleFieldCard label="ID" value={lead.id} />
                  <SimpleFieldCard label="Fuente" value={lead.source} />
                  <SimpleFieldCard label="Canonical source" value={lead.canonical_source} />
                  <SimpleFieldCard label="Estado" value={lead.state} />
                  <SimpleFieldCard label="Contactado por" value={lead.contacted_by} />
                  <SimpleFieldCard label="Top buyer score" value={lead.top_buyer_score} />
                  <SimpleFieldCard label="Data confidence" value={formatPercent(lead.data_confidence_score)} />
                  <SimpleFieldCard label="Sources count" value={lead.sources_count ?? lead.corroborating_sources.length} />
                </div>
              </StructuredSection>

              <StructuredSection title="Huella digital">
                <StructuredValue value={digitalFootprint} />
              </StructuredSection>

              <StructuredSection title="Estado inferido">
                <StructuredValue value={inferredState} />
              </StructuredSection>

              <StructuredSection title="Score breakdown">
                <StructuredValue value={scoreBreakdown} />
              </StructuredSection>

              <StructuredSection title="Lead company data">
                <StructuredValue value={companyData} />
              </StructuredSection>

              <StructuredSection title="Canonical fields">
                <StructuredValue value={canonicalFields} />
              </StructuredSection>

              <StructuredSection title="Fuentes corroborantes y traza por campo">
                <div className="space-y-3">
                  <StructuredValue value={lead.corroborating_sources} />
                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(fieldSources).map(([key, trace]) => (
                      <div key={key} className="rounded-xl border border-slate-200 px-3 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{trace.label}</div>
                        <div className="mt-2 text-sm text-slate-800">{formatValue(trace.value)}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          {trace.source ? <span className="rounded-full bg-slate-100 px-2 py-1">Principal: {trace.source}</span> : null}
                          {trace.confirmations > 0 ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">+{trace.confirmations} confirmaciones</span> : null}
                        </div>
                        {trace.evidence.length > 0 ? (
                          <ul className="mt-3 space-y-1 text-xs text-slate-600">
                            {trace.evidence.map((item, index) => (
                              <li key={`${key}-${index}`}>• {item.label}{item.note ? ` · ${item.note}` : ""}{item.confidence != null ? ` · ${Math.round(item.confidence * 100)}%` : ""}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </StructuredSection>

              <StructuredSection title="Notas internas">
                <StructuredValue value={lead.notes} />
              </StructuredSection>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* 6. Mismo propietario */}
      {ownerGroup.length > 0 ? (
        <SectionCard title="Mismo propietario" description="Otras fichas que conviene revisar antes de salir a contactar.">
          <div className="space-y-2">
            {ownerGroup.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                <Link href={`/admin/leads/${member.id}`} className="min-w-0 flex-1 truncate font-medium text-sky-700 hover:underline">{member.name}</Link>
                {member.niche ? <span className="text-slate-500">{member.niche}</span> : null}
                {member.contact_tier ? <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", TIER_COLORS[member.contact_tier] ?? "bg-slate-100 text-slate-700")}>{member.contact_tier}</span> : null}
                {member.prospect_score != null ? <span className="font-mono text-slate-500">{member.prospect_score}</span> : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {/* Footer admin actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
        <span className="text-xs text-slate-500">Lead ID: {lead.id}</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Volver al listado
          </button>
          {trackingNotice ? (
            <button type="button" onClick={() => router.push("/admin/crm")} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700">
              Ver en CRM
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartTracking}
              disabled={startingTracking}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {startingTracking ? "Iniciando…" : "Iniciar seguimiento"}
            </button>
          )}
        </div>
      </div>

    </AdminPageLayout>
  );
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function normalizeUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function compactPhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function compactPhoneForWhatsapp(value: string): string {
  return value.replace(/\D/g, "");
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "—";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function SourceFieldCard({
  label,
  value,
  trace,
  help,
}: {
  label: string;
  value: ReactNode;
  trace?: LeadFieldSource | null;
  help?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {help ? <HelpTip label={label}>{help}</HelpTip> : null}
      </div>
      <div className="mt-2 text-sm text-slate-900">{value ?? "—"}</div>
      {trace ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {trace.source ? <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">Origen: {trace.source}</span> : null}
            {trace.confirmations > 0 ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">+{trace.confirmations} confirmaciones</span> : null}
            {trace.confidence != null ? <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">{Math.round(trace.confidence * 100)}% confianza</span> : null}
          </div>
          {trace.evidence.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-600">
              {trace.evidence.slice(0, 3).map((item, index) => (
                <li key={`${label}-${index}`}>• {item.label}{item.note ? ` · ${item.note}` : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SimpleFieldCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-sm text-slate-900">{value ?? "—"}</div>
    </div>
  );
}

function CopyPanel({
  title,
  body,
  copyKey,
  copiedKey,
  onCopy,
  footer,
}: {
  title: string;
  body: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <button onClick={() => onCopy(copyKey, body)} className="text-xs font-medium text-sky-700 hover:underline">
          {copiedKey === copyKey ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{body}</p>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

function OutreachRow({ entry }: { entry: OutreachEntry }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
      <div className="mt-0.5 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900 capitalize">{entry.channel}</span>
          {entry.offer_type ? <span className="text-slate-500">{entry.offer_type}</span> : null}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", OUTREACH_STATUS_COLORS[entry.status] ?? "bg-slate-100 text-slate-600")}>
            {entry.status}
          </span>
        </div>
        {entry.notes ? <p className="mt-1 text-xs text-slate-500">{entry.notes}</p> : null}
        {entry.outcome ? <p className="mt-1 text-xs text-slate-600">Resultado: {entry.outcome}</p> : null}
      </div>
      <span className="shrink-0 text-xs text-slate-400">{formatRelative(entry.contacted_at)}</span>
    </div>
  );
}

function StructuredSection({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-slate-200 bg-slate-50/70">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">{title}</summary>
      <div className="border-t border-slate-200 px-4 py-4">{children}</div>
    </details>
  );
}

function buildContactPoints(lead: LeadDetail | null): ContactPoint[] {
  if (!lead) return [];

  const points: ContactPoint[] = [];
  const seen = new Set<string>();

  function addPoint(point: ContactPoint | null) {
    if (!point) return;
    const key = `${point.kind}::${point.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  }

  function makePoint(kind: ContactPointKind, value: string | null | undefined, trace?: LeadFieldSource | null, source?: string | null, reliability?: number | null, note?: string | null): ContactPoint | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "***") return null;
    const resolvedSource = source ?? trace?.source ?? null;
    const resolvedReliability = reliability ?? trace?.confidence ?? null;
    const resolvedNote = note ?? trace?.evidence?.[0]?.note ?? null;
    switch (kind) {
      case "whatsapp": {
        const raw = compactPhoneForWhatsapp(trimmed);
        if (!raw) return null;
        return { id: `${kind}-${raw}`, kind, label: "WhatsApp", value: trimmed, href: `https://wa.me/${raw}`, actionLabel: "Abrir WhatsApp", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      }
      case "phone": {
        const raw = compactPhone(trimmed);
        if (!raw) return null;
        return { id: `${kind}-${raw}`, kind, label: "Teléfono", value: trimmed, href: `tel:${raw}`, actionLabel: "Llamar", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      }
      case "email":
        return { id: `${kind}-${trimmed.toLowerCase()}`, kind, label: "Email", value: trimmed, href: `mailto:${trimmed}`, actionLabel: "Enviar mail", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      case "address":
        return { id: `${kind}-${trimmed.toLowerCase()}`, kind, label: "Dirección", value: trimmed, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`, actionLabel: "Ver mapa", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      case "website":
        return { id: `${kind}-${trimmed.toLowerCase()}`, kind, label: "Website", value: trimmed, href: normalizeUrl(trimmed), actionLabel: "Abrir sitio", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      case "instagram":
        return { id: `${kind}-${trimmed.toLowerCase()}`, kind, label: "Instagram", value: trimmed, href: trimmed.includes("instagram.com") ? normalizeUrl(trimmed) : `https://instagram.com/${trimmed.replace(/^@/, "")}`, actionLabel: "Abrir Instagram", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      case "facebook":
        return { id: `${kind}-${trimmed.toLowerCase()}`, kind, label: "Facebook", value: trimmed, href: trimmed.includes("facebook.com") ? normalizeUrl(trimmed) : `https://facebook.com/${trimmed.replace(/^@/, "")}`, actionLabel: "Abrir Facebook", source: resolvedSource, reliability: resolvedReliability, note: resolvedNote };
      default:
        return null;
    }
  }

  addPoint(makePoint("whatsapp", lead.whatsapp, lead.field_sources?.whatsapp ?? null));
  addPoint(makePoint("phone", lead.phone, lead.field_sources?.phone ?? null));
  addPoint(makePoint("email", lead.email, lead.field_sources?.email ?? null));
  addPoint(makePoint("address", lead.address, lead.field_sources?.address ?? null));
  addPoint(makePoint("website", lead.website, lead.field_sources?.website ?? null));

  const buckets: Array<{ root: unknown; source: string | null }> = [
    { root: lead.canonical_fields, source: lead.canonical_source ?? lead.source },
    { root: lead.digital_footprint, source: lead.canonical_source ?? lead.source },
    { root: lead.lead_company_data, source: lead.canonical_source ?? lead.source },
  ];

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRegex = /\+?[\d()\-\s]{7,}/;

  function visit(value: unknown, keyPath: string[], inheritedSource: string | null, inheritedConfidence: number | null, depth = 0) {
    if (depth > 10) return;
    if (typeof value === "string") {
      const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
      const trimmed = value.trim();
      if (!trimmed) return;
      if (key.includes("instagram") || /instagram\.com/i.test(trimmed)) {
        addPoint(makePoint("instagram", trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      if (key.includes("facebook") || /facebook\.com/i.test(trimmed)) {
        addPoint(makePoint("facebook", trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      if ((key.includes("mail") || key.includes("email") || emailRegex.test(trimmed)) && emailRegex.test(trimmed)) {
        addPoint(makePoint("email", trimmed.match(emailRegex)?.[0] ?? trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      if ((key.includes("phone") || key.includes("whatsapp") || key.includes("mobile")) && phoneRegex.test(trimmed)) {
        const kind: ContactPointKind = key.includes("whatsapp") ? "whatsapp" : "phone";
        addPoint(makePoint(kind, trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      if ((key.includes("address") || key.includes("direccion") || key.includes("location")) && trimmed.length > 8) {
        addPoint(makePoint("address", trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      if ((key.includes("website") || key.includes("site") || key.includes("web")) && /[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) {
        addPoint(makePoint("website", trimmed, null, inheritedSource, inheritedConfidence, `Detectado en ${keyPath.join(".")}`));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...keyPath, String(index)], inheritedSource, inheritedConfidence, depth + 1));
      return;
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const nextSource = typeof record.source === "string" ? record.source : inheritedSource;
      const nextConfidence = typeof record.confidence === "number" ? record.confidence : inheritedConfidence;
      Object.entries(record).forEach(([childKey, childValue]) => {
        visit(childValue, [...keyPath, childKey], nextSource, nextConfidence, depth + 1);
      });
    }
  }

  buckets.forEach((bucket) => visit(bucket.root, [], bucket.source, null));

  // Enriquecer con favorito, liveness y actividad social (datos ya persistidos).
  const fp = (lead.digital_footprint ?? {}) as {
    social_activity?: { profiles?: Record<string, ContactSocialActivity> };
    heuristic_discovery?: { selected?: Record<string, { liveness?: ContactLiveness } | null> };
  };
  const socialProfiles = fp.social_activity?.profiles ?? {};
  const selected = fp.heuristic_discovery?.selected ?? {};
  const favorites = ((lead as { favorite_contacts?: Array<{ kind: string; value: string }> }).favorite_contacts ?? []);
  const isFav = (p: ContactPoint): boolean =>
    favorites.some((f) => f.kind === p.kind && f.value.trim().toLowerCase() === p.value.trim().toLowerCase());

  for (const point of points) {
    point.favorite = isFav(point);
    if (point.kind === "instagram" || point.kind === "facebook") {
      const liveness = selected[point.kind]?.liveness ?? null;
      if (liveness) point.liveness = liveness;
      // No mostrar métricas de actividad de una red muerta (sería contradictorio con el
      // badge "No disponible"); la actividad solo aplica a redes vivas.
      const profile = socialProfiles[point.kind];
      if (profile && liveness?.state !== "dead") point.activity = profile;
    }
  }

  const order: ContactPointKind[] = ["whatsapp", "phone", "email", "instagram", "facebook", "website", "address"];
  return points.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind) || left.value.localeCompare(right.value));
}

function StructuredValue({ value }: { value: unknown }) {
  if (value == null || value === "") {
    return <p className="text-sm text-slate-500">Sin datos.</p>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="text-sm text-slate-700">{formatValue(value)}</p>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <StructuredValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map(([key, entryValue]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key}</div>
            <div className="mt-2 text-sm text-slate-700">
              <StructuredValue value={entryValue} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-sm text-slate-500">Dato no legible.</p>;
}
