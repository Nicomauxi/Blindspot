"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ApiError,
  createLeadFeedback,
  createCampaign,
  createOutreach,
  createTracking,
  generateLeadBrief,
  generateOffer,
  getLead,
  getLeadFeedbackSummary,
  getOwnerGroup,
  listLeadFeedback,
  listCampaigns,
  listOutreach,
  type Campaign,
  type CommercialEvidenceNode,
  type LeadFeedbackEntry,
  type LeadFeedbackSummaryEntry,
  type LeadAssistantBrief,
  type LeadDetail,
  type LeadFieldSource,
  type OfferPackage,
  type OutreachEntry,
  type OwnerGroupMember,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  buildLeadFeedbackFieldOptions,
  mergeLeadFeedbackSummary,
  resolveLeadFeedbackFieldValue,
} from "@/lib/lead-feedback";
import { cn, formatRelative } from "@/lib/utils";
import { AdminPageLayout, EmptyPanel, HelpTip, SectionCard, StatCard } from "@/components/admin-shell";

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-sky-100 text-sky-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-slate-100 text-slate-700",
  X: "bg-rose-100 text-rose-700",
};

const STATUS_COLORS: Record<string, string> = {
  contacted: "bg-sky-50 text-sky-700",
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

type CampaignStartForm = {
  mode: "existing" | "new";
  campaignId: string;
  name: string;
  channel: string;
  status: string;
  notes: string;
  createOutreach: boolean;
};

type ContactPointKind = "whatsapp" | "phone" | "email" | "address" | "website" | "instagram" | "facebook";

type ContactPoint = {
  id: string;
  kind: ContactPointKind;
  label: string;
  value: string;
  href: string;
  actionLabel: string;
  source: string | null;
  reliability: number | null;
  note: string | null;
};

type LeadFeedbackDraft = {
  fieldKey: string;
  verdict: "good" | "bad";
  comment: string;
};

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
  const router = useRouter();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [outreach, setOutreach] = useState<OutreachEntry[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroupMember[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<LeadFeedbackEntry[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<LeadFeedbackSummaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferPackage | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerChannel, setOfferChannel] = useState("whatsapp");
  const [assistant, setAssistant] = useState<LeadAssistantBrief | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [startingCampaign, setStartingCampaign] = useState(false);
  const [startingTracking, setStartingTracking] = useState(false);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [creatingFeedback, setCreatingFeedback] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<LeadFeedbackDraft>({
    fieldKey: "",
    verdict: "good",
    comment: "",
  });
  const [campaignForm, setCampaignForm] = useState<CampaignStartForm>({
    mode: "existing",
    campaignId: "",
    name: "",
    channel: "whatsapp",
    status: "contacted",
    notes: "",
    createOutreach: true,
  });

  useEffect(() => {
    if (!token || !id) return;
    setLoading(true);
    Promise.all([
      getLead(token, id),
      listOutreach(token, { lead_id: id, limit: 20 }),
      getOwnerGroup(token, id),
      listCampaigns(token).catch(() => ({ data: [] })),
    ])
      .then(([leadRes, outreachRes, ownerGroupRes, campaignsRes]) => {
        setLead(leadRes.data);
        setOutreach(outreachRes.data);
        setOwnerGroup(ownerGroupRes.data ?? []);
        setCampaigns(campaignsRes.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar lead"))
      .finally(() => setLoading(false));
  }, [token, id]);

  useEffect(() => {
    if (!token || !id) return;
    setFeedbackLoading(true);
    Promise.all([listLeadFeedback(token, id, { limit: 20 }), getLeadFeedbackSummary(token, id)])
      .then(([feedbackRes, summaryRes]) => {
        setFeedbackEntries(feedbackRes.data);
        setFeedbackSummary(summaryRes.data);
        setFeedbackError(null);
      })
      .catch((err) => setFeedbackError(err instanceof Error ? err.message : "No se pudo cargar el feedback humano."))
      .finally(() => setFeedbackLoading(false));
  }, [token, id]);

  const recentCampaign = useMemo(() => {
    const latestWithCampaign = outreach.find((entry) => entry.campaign_id);
    if (!latestWithCampaign) return null;
    return campaigns.find((campaign) => campaign.id === latestWithCampaign.campaign_id) ?? null;
  }, [campaigns, outreach]);

  useEffect(() => {
    if (!token || !id || !lead) return;
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
  }, [id, lead, token]);

  useEffect(() => {
    if (!lead) return;
    const dateLabel = new Date().toISOString().slice(0, 10);
    setCampaignForm((current) => ({
      ...current,
      name: current.name || `${lead.name} · ${lead.primary_offer ?? lead.niche ?? "campaña"} · ${dateLabel}`,
      campaignId:
        current.campaignId ||
        recentCampaign?.id ||
        campaigns.find((campaign) => campaign.status !== "closed")?.id ||
        "",
      channel: current.channel || (assistant?.recommended_channel ?? "whatsapp"),
    }));
  }, [assistant?.recommended_channel, campaigns, lead, recentCampaign]);

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
      { label: "Existe al menos un canal usable", done: Boolean(lead.whatsapp || lead.email || lead.phone) },
      { label: "El contacto parece listo", done: lead.contact_ready === true },
      { label: "Ya se revisó historial de acciones", done: outreach.length > 0 },
      { label: "Se validó si comparte owner group", done: ownerGroup.length > 0 || !lead.owner_group_id },
    ];
  }, [assistant?.personalized_pitch, lead, outreach.length, ownerGroup.length]);

  const contactPoints = useMemo(() => buildContactPoints(lead), [lead]);
  const feedbackFieldOptions = useMemo(() => buildLeadFeedbackFieldOptions(lead), [lead]);
  const feedbackFieldValue = useMemo(
    () => resolveLeadFeedbackFieldValue(lead, feedbackDraft.fieldKey),
    [feedbackDraft.fieldKey, lead]
  );

  useEffect(() => {
    if (feedbackFieldOptions.length === 0) return;
    setFeedbackDraft((current) =>
      current.fieldKey && feedbackFieldOptions.some((option) => option.key === current.fieldKey)
        ? current
        : { ...current, fieldKey: feedbackFieldOptions[0]!.key }
    );
  }, [feedbackFieldOptions]);

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

  async function handleStartCampaign() {
    if (!token || !lead) return;
    setStartingCampaign(true);
    setError(null);
    try {
      let campaignId = campaignForm.campaignId;
      if (campaignForm.mode === "new") {
        const res = await createCampaign(token, {
          name: campaignForm.name.trim(),
          status: "active",
          notes: campaignForm.notes.trim() || undefined,
          segment_filter: {
            lead_id: lead.id,
            niche: lead.niche,
            source: lead.source,
            primary_offer: lead.primary_offer,
          },
        });
        campaignId = res.data.id;
        setCampaigns((prev) => [res.data, ...prev]);
      }

      if (!campaignId) {
        throw new Error("Elegí o creá una campaña antes de continuar");
      }

      if (campaignForm.createOutreach) {
        const outreachRes = await createOutreach(token, {
          lead_id: lead.id,
          campaign_id: campaignId,
          channel: campaignForm.channel,
          status: campaignForm.status,
          notes: campaignForm.notes.trim() || undefined,
        });
        setOutreach((prev) => [outreachRes.data, ...prev]);
      } else {
        router.push(`/admin/crm?campaign_id=${campaignId}`);
        return;
      }

      setShowCampaignModal(false);
      router.push(`/admin/crm?campaign_id=${campaignId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la campaña");
    } finally {
      setStartingCampaign(false);
    }
  }

  async function handleStartTracking() {
    if (!token || !lead) return;
    setStartingTracking(true);
    setTrackingNotice(null);
    try {
      await createTracking(token, { lead_id: lead.id });
      setTrackingNotice("Seguimiento iniciado.");
      router.push("/admin/crm");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setTrackingNotice("Ya existe un seguimiento activo para este lead. Buscalo en el board de CRM.");
      } else {
        setTrackingNotice("No se pudo iniciar el seguimiento. Intentá de nuevo.");
      }
    } finally {
      setStartingTracking(false);
    }
  }

  function copyText(key: string, value: string | null | undefined) {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
  }

  async function handleCreateFeedback() {
    if (!token || !lead || !feedbackDraft.fieldKey) return;
    setCreatingFeedback(true);
    setFeedbackError(null);
    setFeedbackNotice(null);
    try {
      const response = await createLeadFeedback(token, lead.id, {
        field_key: feedbackDraft.fieldKey,
        field_value: feedbackFieldValue || undefined,
        verdict: feedbackDraft.verdict,
        comment: feedbackDraft.comment.trim() || undefined,
      });
      setFeedbackEntries((current) => [response.data, ...current]);
      setFeedbackSummary((current) => mergeLeadFeedbackSummary(current, response.data));
      setFeedbackDraft((current) => ({ ...current, verdict: "good", comment: "" }));
      setFeedbackNotice(`Feedback guardado para ${feedbackDraft.fieldKey}.`);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "No se pudo guardar el feedback humano.");
    } finally {
      setCreatingFeedback(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400">Cargando ficha…</div>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  if (!lead) return null;

  const recommendedChannelLabel = CHANNEL_LABELS[assistant?.recommended_channel ?? ""] ?? CHANNEL_LABELS[offerChannel] ?? "Canal no definido";

  return (
    <AdminPageLayout
      eyebrow="Lead"
      title={lead.name}
      description="Vista pitch-first con contexto comercial, trazabilidad de cada dato y acceso completo al registro del lead."
      actions={
        <>
          <button onClick={() => router.back()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
            Volver
          </button>
          <button
            onClick={handleStartTracking}
            disabled={startingTracking}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {startingTracking ? "Iniciando…" : "Iniciar seguimiento"}
          </button>
          <button onClick={() => setShowCampaignModal(true)} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700">
            Iniciar campaña
          </button>
          <Link href={recentCampaign ? `/admin/crm?campaign_id=${recentCampaign.id}` : `/admin/crm?lead_id=${lead.id}`} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100">
            Ver acciones
          </Link>
        </>
      }
    >
      {recentCampaign ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Campaña asociada más reciente</div>
              <div className="mt-1">{recentCampaign.name} · {recentCampaign.status}</div>
            </div>
            <Link href={`/admin/crm?campaign_id=${recentCampaign.id}`} className="rounded-lg border border-sky-200 bg-white px-3 py-2 font-medium text-sky-700 hover:bg-sky-100">
              Abrir acciones de esta campaña
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Prospect score" value={lead.prospect_score ?? "—"} hint="Prioridad comercial relativa" tone="good" />
        <StatCard label="Oferta sugerida" value={lead.primary_offer ?? "—"} hint={lead.pitch_hook ?? "Sin pitch hook sugerido"} tone="info" />
        <StatCard label="Canal recomendado" value={recommendedChannelLabel} hint={lead.contact_ready ? "Listo para primer toque" : "Conviene validar antes de salir"} />
        <StatCard label="Fuentes disponibles" value={lead.sources_count ?? lead.corroborating_sources.length ?? 0} hint={lead.canonical_source ? `Fuente principal: ${lead.canonical_source}` : "Sin canonical_source"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
        <SectionCard title="Resumen comercial" description="Qué vender, por qué y con qué evidencia mínima para avanzar.">
          <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
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
                  <EmptyPanel
                    title="Sin resumen asistido"
                    description={assistantError ?? "La ficha sigue disponible con todos los datos y su trazabilidad."}
                  />
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

        <SectionCard title="Asistente comercial" description="Material listo para usar por un usuario comercial sin bajar a detalle técnico.">
          {assistantLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-24 rounded bg-slate-100" />
              <div className="h-24 rounded bg-slate-100" />
            </div>
          ) : assistant ? (
            <div className="space-y-4">
              <CopyPanel title="Primer mensaje sugerido" body={assistant.first_message} copyKey="assistant-message" copiedKey={copiedKey} onCopy={copyText} />
              <div className="grid gap-3 md:grid-cols-2">
                <ListPanel title="Objeciones probables" items={assistant.likely_objections} />
                <ListPanel title="Cómo responder" items={assistant.objection_handling} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canal sugerido</div>
                <p className="mt-1 font-medium text-slate-900">{recommendedChannelLabel}</p>
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="No se pudo generar el asistente comercial"
              description={assistantError ?? "Podés seguir trabajando con la evidencia del lead y generar un mensaje manual."}
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
        <SectionCard title="Contacto y datos listos para vender" description="Mostramos todos los contactos y redes encontradas, con acción directa y fiabilidad por dato.">
          <div className="space-y-3">
            {contactPoints.length === 0 ? (
              <EmptyPanel title="Sin contactos accionables" description="No encontramos teléfonos, mails, direcciones ni redes utilizables en este lead." />
            ) : (
              contactPoints.map((point) => <ContactPointRow key={point.id} point={point} />)
            )}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SourceFieldCard label="Contacto listo" value={formatBoolean(lead.contact_ready)} trace={fieldSources.contact_ready} />
            <SourceFieldCard label="Tier de contacto" value={lead.contact_tier} trace={fieldSources.contact_tier} />
            <SourceFieldCard label="Fuente principal" value={lead.canonical_source ?? lead.source} trace={fieldSources.name} help="Usamos la misma base de evidencia que respalda el registro principal del lead." />
          </div>
        </SectionCard>

        <SectionCard title="Lectura del negocio" description="Contexto comercial útil antes de escribir o llamar.">
          <div className="grid gap-3 md:grid-cols-2">
            <SourceFieldCard label="Rubro" value={lead.niche} trace={fieldSources.niche} />
            <SourceFieldCard label="Estado comercial" value={lead.business_status} trace={fieldSources.business_status} />
            <SourceFieldCard label="Rating" value={lead.rating != null ? `${lead.rating} ★` : null} trace={fieldSources.rating} />
            <SourceFieldCard label="Reseñas" value={lead.review_count} trace={fieldSources.review_count} />
            <SourceFieldCard label="Top buyer" value={lead.top_buyer_type} trace={fieldSources.top_buyer_type} />
            <SimpleFieldCard label="Confianza fuente" value={formatPercent(lead.source_confidence)} />
            <SimpleFieldCard label="Confiabilidad contacto" value={formatPercent(lead.contact_reliability_score)} />
            <SimpleFieldCard label="Creado" value={lead.created_at ? formatRelative(lead.created_at) : "—"} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Feedback humano" description="Validación manual por campo para dejar trazabilidad operativa sin perder el dato original del lead.">
        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Registrar validación</div>
              <p className="mt-2 text-sm text-slate-600">Marcá si un dato está bien o mal, dejá contexto y guardalo con el usuario autenticado.</p>
            </div>
            <label className="block text-sm text-slate-700">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Campo</span>
              <select
                value={feedbackDraft.fieldKey}
                onChange={(event) => setFeedbackDraft((current) => ({ ...current, fieldKey: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                {feedbackFieldOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valor actual</div>
              <div className="mt-2 text-sm text-slate-800">{feedbackFieldValue || "Sin valor visible para este campo."}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFeedbackDraft((current) => ({ ...current, verdict: "good" }))}
                className={cn("rounded-lg px-3 py-2 text-sm font-medium", feedbackDraft.verdict === "good" ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700")}
              >
                Dato correcto
              </button>
              <button
                type="button"
                onClick={() => setFeedbackDraft((current) => ({ ...current, verdict: "bad" }))}
                className={cn("rounded-lg px-3 py-2 text-sm font-medium", feedbackDraft.verdict === "bad" ? "bg-rose-600 text-white" : "border border-slate-300 bg-white text-slate-700")}
              >
                Dato incorrecto
              </button>
            </div>
            <label className="block text-sm text-slate-700">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Comentario</span>
              <textarea
                value={feedbackDraft.comment}
                onChange={(event) => setFeedbackDraft((current) => ({ ...current, comment: event.target.value }))}
                rows={4}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                placeholder="Ej: el teléfono responde pero corresponde a otra sucursal"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleCreateFeedback()}
                disabled={creatingFeedback || !feedbackDraft.fieldKey}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingFeedback ? "Guardando…" : "Guardar feedback"}
              </button>
              {feedbackNotice ? <span className="text-sm text-emerald-700">{feedbackNotice}</span> : null}
            </div>
            {feedbackError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{feedbackError}</div> : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resumen por campo</div>
              {feedbackLoading ? (
                <div className="mt-3 text-sm text-slate-500">Cargando feedback…</div>
              ) : feedbackSummary.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">Todavía no hay validaciones humanas para este lead.</div>
              ) : (
                <div className="mt-3 space-y-3">
                  {feedbackSummary.map((entry) => (
                    <div key={entry.field_key} className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-slate-900">{entry.field_key}</div>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", entry.latest_verdict === "good" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{entry.latest_verdict === "good" ? "Último: correcto" : "Último: incorrecto"}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-1">Total: {entry.total}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Good: {entry.good_count}</span>
                        <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">Bad: {entry.bad_count}</span>
                      </div>
                      {entry.latest_comment ? <p className="mt-2 text-xs text-slate-600">{entry.latest_comment}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Actividad reciente</div>
              {feedbackLoading ? (
                <div className="mt-3 text-sm text-slate-500">Cargando actividad…</div>
              ) : feedbackEntries.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">Sin eventos de feedback todavía.</div>
              ) : (
                <div className="mt-3 space-y-3">
                  {feedbackEntries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-slate-200 px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-slate-900">{entry.field_key}</div>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", entry.verdict === "good" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{entry.verdict === "good" ? "Correcto" : "Incorrecto"}</span>
                      </div>
                      {entry.field_value != null ? <div className="mt-2 text-xs text-slate-500">Valor: {String(entry.field_value)}</div> : null}
                      {entry.comment ? <p className="mt-2 text-xs text-slate-600">{entry.comment}</p> : null}
                      <div className="mt-2 text-[11px] text-slate-400">{entry.actor_role} · {formatRelative(entry.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Traza de evidencia comercial" description="Por qué el sistema sugiere este pitch, este timing y este nivel de readiness.">
        {evidenceTree.length === 0 ? (
          <EmptyPanel title="Sin traza comercial disponible" description="Todavía no hay señales derivadas suficientes para mostrar evidencia resumida." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {evidenceTree.map((node) => (
              <EvidenceNodeCard key={node.id} node={node} />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
        <SectionCard title="Generar mensaje alternativo" description="Versión rápida por canal si querés otro texto además del pitch asistido.">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={offerChannel} onChange={(event) => setOfferChannel(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="phone">Teléfono</option>
            </select>
            <button onClick={() => void handleGenerateOffer()} disabled={offerLoading} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
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
        </SectionCard>

        <SectionCard title="Outreach e historial" description="Qué pasó con este lead y cómo seguir sin duplicar trabajo.">
          {outreach.length === 0 ? (
            <EmptyPanel title="Sin contactos registrados" description="Todavía no hay outreach para este lead." action={<button onClick={() => setShowCampaignModal(true)} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">Iniciar campaña</button>} />
          ) : (
            <div className="space-y-2">
              {outreach.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[entry.status] ?? "bg-slate-50 text-slate-600")}>{entry.status}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-800">{CHANNEL_LABELS[entry.channel] ?? entry.channel}{entry.campaign_id ? <span className="text-slate-400"> · campaña</span> : null}</div>
                    {entry.notes ? <p className="mt-1 text-xs text-slate-500">{entry.notes}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatRelative(entry.contacted_at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Datos completos del lead" description="Todo el registro disponible, organizado para lectura progresiva sin exponer JSON crudo como vista principal.">
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
      </SectionCard>

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

      {showCampaignModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Iniciar campaña para {lead.name}</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button onClick={() => setCampaignForm((current) => ({ ...current, mode: "existing" }))} className={cn("rounded-lg px-3 py-2 text-sm", campaignForm.mode === "existing" ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-700")}>Usar campaña existente</button>
                  <button onClick={() => setCampaignForm((current) => ({ ...current, mode: "new" }))} className={cn("rounded-lg px-3 py-2 text-sm", campaignForm.mode === "new" ? "bg-sky-600 text-white" : "border border-slate-300 text-slate-700")}>Crear campaña nueva</button>
                </div>

                {campaignForm.mode === "existing" ? (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Campaña</label>
                    <select value={campaignForm.campaignId} onChange={(event) => setCampaignForm((current) => ({ ...current, campaignId: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                      <option value="">Elegí una campaña</option>
                      {campaigns.filter((campaign) => campaign.status !== "closed").map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre sugerido</label>
                      <input type="text" value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      El <code>segment_filter</code> se precarga con <code>lead_id</code>, <code>niche</code>, <code>source</code> y <code>primary_offer</code> para dejar la campaña contextualizada desde esta ficha.
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={campaignForm.createOutreach} onChange={(event) => setCampaignForm((current) => ({ ...current, createOutreach: event.target.checked }))} className="rounded border-slate-300" />
                  Registrar el primer outreach ahora
                </label>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Canal</label>
                  <select value={campaignForm.channel} onChange={(event) => setCampaignForm((current) => ({ ...current, channel: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" disabled={!campaignForm.createOutreach}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="phone">Teléfono</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Estado inicial</label>
                  <select value={campaignForm.status} onChange={(event) => setCampaignForm((current) => ({ ...current, status: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" disabled={!campaignForm.createOutreach}>
                    <option value="contacted">contacted</option>
                    <option value="responded">responded</option>
                    <option value="interested">interested</option>
                    <option value="no_response">no_response</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Notas</label>
                  <textarea value={campaignForm.notes} onChange={(event) => setCampaignForm((current) => ({ ...current, notes: event.target.value }))} rows={4} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" placeholder="Contexto del primer toque o motivo de la campaña" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowCampaignModal(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Cancelar</button>
              <button onClick={() => void handleStartCampaign()} disabled={startingCampaign} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                {startingCampaign ? "Guardando…" : campaignForm.createOutreach ? "Crear y registrar outreach" : "Crear y abrir acciones"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

function sourceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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

function EvidenceNodeCard({ node }: { node: CommercialEvidenceNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{node.title}</div>
          <p className="mt-2 text-sm font-medium text-slate-900">{node.summary}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", node.strength === "high" ? "bg-emerald-100 text-emerald-700" : node.strength === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>{node.strength}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        {node.source ? <span className="rounded-full bg-slate-100 px-2 py-1">Origen: {node.source}</span> : null}
        {node.confirmations > 0 ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">+{node.confirmations} confirmaciones</span> : null}
      </div>
      {node.evidence.length > 0 ? (
        <ul className="mt-4 space-y-2 text-sm text-slate-700">
          {node.evidence.map((item) => (
            <li key={item} className="rounded-xl bg-slate-50 px-3 py-2">{item}</li>
          ))}
        </ul>
      ) : null}
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

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Sin puntos sugeridos.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {items.map((item) => (
            <li key={item} className="rounded-lg bg-slate-50 px-3 py-2">{item}</li>
          ))}
        </ul>
      )}
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
    if (!trimmed) return null;
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

  function visit(value: unknown, keyPath: string[], inheritedSource: string | null, inheritedConfidence: number | null) {
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
      value.forEach((entry, index) => visit(entry, [...keyPath, String(index)], inheritedSource, inheritedConfidence));
      return;
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const nextSource = typeof record.source === "string" ? record.source : inheritedSource;
      const nextConfidence = typeof record.confidence === "number" ? record.confidence : inheritedConfidence;
      Object.entries(record).forEach(([childKey, childValue]) => {
        visit(childValue, [...keyPath, childKey], nextSource, nextConfidence);
      });
    }
  }

  buckets.forEach((bucket) => visit(bucket.root, [], bucket.source, null));

  const order: ContactPointKind[] = ["whatsapp", "phone", "email", "instagram", "facebook", "website", "address"];
  return points.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind) || left.value.localeCompare(right.value));
}

function ContactPointRow({ point }: { point: ContactPoint }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{point.label}</span>
          {point.reliability != null ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{Math.round(point.reliability * 100)}% fiable</span> : null}
          {point.source ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{sourceLabel(point.source)}</span> : null}
        </div>
        <div className="mt-2 break-all text-sm font-medium text-slate-900">{point.value}</div>
        {point.note ? <div className="mt-1 text-xs text-slate-500">{point.note}</div> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <a href={point.href} target={point.kind === "phone" || point.kind === "email" ? undefined : "_blank"} rel={point.kind === "phone" || point.kind === "email" ? undefined : "noreferrer"} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700">
          {point.actionLabel}
        </a>
      </div>
    </div>
  );
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
