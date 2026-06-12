"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type FeedbackVerdict = "good" | "bad";
export type RejectionReason = "no_pertenece_al_lead" | "dato_desactualizado" | "fuera_de_servicio" | "otro";

export interface FeedbackPayload {
  fieldKey: string;
  value: string;
  verdict: FeedbackVerdict;
  comment?: string;
  rejectionReason?: RejectionReason;
  reassignToLeadId?: string;
}

export type FeedbackHandler = (payload: FeedbackPayload) => Promise<void>;
export type FavoriteHandler = (point: ContactPoint, next: boolean) => Promise<void>;
export type LeadSearchHandler = (query: string) => Promise<Array<{ id: string; name: string; niche: string | null; city: string | null }>>;

export type ContactPointKind = "whatsapp" | "phone" | "email" | "address" | "website" | "instagram" | "facebook";

export interface ContactSocialActivity {
  followers: number | null;
  likes: number | null;
  posts: number | null;
  audience_tier: "low" | "medium" | "high" | null;
  activity_status: "active" | "abandoned" | "unknown";
}

export interface ContactLiveness {
  state: "alive" | "dead" | "unverified";
  reason: string | null;
  checked_at: string | null;
}

export interface ContactPoint {
  id: string;
  kind: ContactPointKind;
  label: string;
  value: string;
  href: string;
  actionLabel: string;
  source: string | null;
  reliability: number | null;
  note: string | null;
  favorite?: boolean;
  liveness?: ContactLiveness | null;
  activity?: ContactSocialActivity | null;
}

const REASON_OPTIONS: Array<{ value: RejectionReason; label: string }> = [
  { value: "no_pertenece_al_lead", label: "No pertenece al lead" },
  { value: "dato_desactualizado", label: "Dato desactualizado" },
  { value: "fuera_de_servicio", label: "Número/cuenta fuera de servicio" },
  { value: "otro", label: "Otro" },
];

const SOCIAL_KINDS: ContactPointKind[] = ["instagram", "facebook"];
// Orden por accionabilidad comercial (menor = más arriba).
const KIND_PRIORITY: Record<ContactPointKind, number> = {
  whatsapp: 0, phone: 1, email: 2, instagram: 3, facebook: 4, website: 5, address: 6,
};

function classifyReliability(value: number | null): "high" | "medium" | "low" {
  if (value == null) return "low";
  if (value >= 0.7) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}

function reliabilityClass(tier: "high" | "medium" | "low"): string {
  if (tier === "high") return "bg-emerald-100 text-emerald-700";
  if (tier === "medium") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    google_places: "Google Places", yelu: "Yelu", pedidosya: "PedidosYa", mintur: "MINTUR",
    osm: "OSM", social_search: "Social", manual: "Manual", scoring_engine: "Motor", inference_engine: "Inferido",
  };
  return map[source] ?? source.replaceAll("_", " ");
}

const STATUS_LABEL: Record<string, string> = { active: "Activa", abandoned: "Abandonada", unknown: "Sin confirmar" };
const TIER_LABEL: Record<string, string> = { high: "alta", medium: "media", low: "baja" };

function isDead(point: ContactPoint): boolean {
  return point.liveness?.state === "dead";
}

// Orden: favoritos primero, luego por accionabilidad; muertos al fondo.
function sortPoints(points: ContactPoint[]): ContactPoint[] {
  return [...points].sort((a, b) => {
    if (isDead(a) !== isDead(b)) return isDead(a) ? 1 : -1;
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    if (KIND_PRIORITY[a.kind] !== KIND_PRIORITY[b.kind]) return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    return (b.reliability ?? -1) - (a.reliability ?? -1);
  });
}

function kindIcon(kind: ContactPointKind): string {
  return { whatsapp: "💬", phone: "📞", email: "✉️", instagram: "📷", facebook: "👍", website: "🌐", address: "📍" }[kind];
}

// ---------- Detail panel ----------

interface ContactDetailProps {
  point: ContactPoint;
  leadId?: string;
  onFeedback?: FeedbackHandler;
  onToggleFavorite?: FavoriteHandler;
  onSearchLeads?: LeadSearchHandler;
}

function ContactDetail({ point, leadId, onFeedback, onToggleFavorite, onSearchLeads }: ContactDetailProps) {
  const tier = classifyReliability(point.reliability);
  const [state, setState] = useState<"idle" | "bad" | "saving" | "done">("idle");
  const [reason, setReason] = useState<RejectionReason>("no_pertenece_al_lead");
  const [comment, setComment] = useState("");
  const [reassign, setReassign] = useState(false);
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<Array<{ id: string; name: string; niche: string | null; city: string | null }>>([]);
  const [targetLead, setTargetLead] = useState<{ id: string; name: string } | null>(null);

  // Reset al cambiar de contacto.
  useEffect(() => {
    setState("idle"); setReason("no_pertenece_al_lead"); setComment(""); setReassign(false);
    setLeadQuery(""); setLeadResults([]); setTargetLead(null);
  }, [point.id]);

  useEffect(() => {
    if (!reassign || !onSearchLeads || leadQuery.trim().length < 2) { setLeadResults([]); return; }
    let active = true;
    const t = setTimeout(() => {
      // N69: filtrar por el UUID real del lead — point.id es "email-foo@bar" y el filtro era un no-op.
      onSearchLeads(leadQuery.trim()).then((r) => { if (active) setLeadResults(r.filter((l) => l.id !== (leadId ?? point.id))); }).catch(() => {});
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [reassign, leadQuery, onSearchLeads, point.id, leadId]);

  async function submit(verdict: FeedbackVerdict, payload?: Partial<FeedbackPayload>) {
    if (!onFeedback) return;
    setState("saving");
    try {
      await onFeedback({ fieldKey: point.kind, value: point.value, verdict, ...payload });
      setState("done");
    } catch {
      setState("idle");
    }
  }

  const dead = isDead(point);
  const reassignEnabled = reason === "no_pertenece_al_lead";

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      {/* Header: valor + favorito + CTA */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{kindIcon(point.kind)}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{point.label}</span>
            {dead ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">No disponible</span> : null}
          </div>
          <div className="mt-1 break-all text-base font-semibold text-slate-900">{point.value}</div>
          {dead ? <div className="mt-1 text-xs text-slate-500">La página no respondió o fue eliminada{point.liveness?.checked_at ? `. Verificado el ${new Date(point.liveness.checked_at).toLocaleDateString("es-UY")}` : ""}.</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onToggleFavorite ? (
            <button
              type="button"
              title={point.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
              onClick={() => void onToggleFavorite(point, !point.favorite)}
              className={cn("rounded-lg border px-2.5 py-2 text-base", point.favorite ? "border-amber-300 bg-amber-50 text-amber-600" : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50")}
            >
              {point.favorite ? "★" : "☆"}
            </button>
          ) : null}
          <a
            href={point.href}
            target={point.kind === "phone" || point.kind === "email" ? undefined : "_blank"}
            rel={point.kind === "phone" || point.kind === "email" ? undefined : "noreferrer"}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            {point.actionLabel}
          </a>
        </div>
      </div>

      {/* Actividad social embebida */}
      {SOCIAL_KINDS.includes(point.kind) && point.activity ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actividad en esta red</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold",
              point.activity.activity_status === "active" ? "bg-emerald-100 text-emerald-700"
                : point.activity.activity_status === "abandoned" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>
              {STATUS_LABEL[point.activity.activity_status]}
            </span>
            {point.activity.audience_tier ? <span className="text-xs text-slate-600">Audiencia {TIER_LABEL[point.activity.audience_tier]}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            {point.activity.followers != null ? <span>{point.activity.followers.toLocaleString("es-UY")} seguidores</span> : null}
            {point.activity.likes != null ? <span>{point.activity.likes.toLocaleString("es-UY")} likes</span> : null}
            {point.activity.posts != null ? <span>{point.activity.posts.toLocaleString("es-UY")} posts</span> : null}
            {point.activity.followers == null && point.activity.likes == null && point.activity.posts == null ? <span>Métricas no disponibles públicamente</span> : null}
          </div>
        </div>
      ) : null}

      {/* Fuente + fiabilidad */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-full px-2 py-0.5 font-semibold", reliabilityClass(tier))}>
          Fiabilidad {point.reliability != null ? `${Math.round(point.reliability * 100)}%` : "—"}
        </span>
        {point.source ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{sourceLabel(point.source)}</span> : null}
        {point.note ? <span className="text-slate-500">{point.note}</span> : null}
      </div>

      {/* Acciones de feedback */}
      {onFeedback ? (
        state === "done" ? (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Feedback guardado ✓</div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button type="button" disabled={state === "saving"} onClick={() => void submit("good")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-40">
                👍 Dato correcto
              </button>
              <button type="button" disabled={state === "saving"} onClick={() => setState((s) => (s === "bad" ? "idle" : "bad"))}
                className={cn("rounded-lg border px-3 py-2 text-sm hover:border-rose-300 hover:bg-rose-50 disabled:opacity-40", state === "bad" ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white")}>
                👎 Dato incorrecto
              </button>
            </div>

            {state === "bad" || state === "saving" ? (
              <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-semibold text-rose-700">¿Por qué este dato es incorrecto?</p>
                <div className="space-y-1">
                  {REASON_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="radio" name="reason" checked={reason === opt.value} onChange={() => setReason(opt.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {reason === "otro" ? (
                  <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Detalle del motivo" className="w-full rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-rose-400" />
                ) : null}

                {onSearchLeads ? (
                  <div className="space-y-1">
                    <label className={cn("flex items-center gap-2 text-sm", reassignEnabled ? "text-slate-700" : "text-slate-400")}>
                      <input type="checkbox" disabled={!reassignEnabled} checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
                      Reasignar este contacto a otro lead
                    </label>
                    {!reassignEnabled ? <p className="text-[11px] text-slate-400">Solo disponible con &quot;No pertenece al lead&quot;.</p> : null}
                    {reassign && reassignEnabled ? (
                      <div className="relative">
                        <input value={targetLead ? targetLead.name : leadQuery} onChange={(e) => { setTargetLead(null); setLeadQuery(e.target.value); }}
                          placeholder="Buscar lead destino…" className="w-full rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-rose-400" />
                        {!targetLead && leadResults.length > 0 ? (
                          <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {leadResults.map((l) => (
                              <button key={l.id} type="button" onClick={() => { setTargetLead({ id: l.id, name: l.name }); setLeadResults([]); }}
                                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                                <span className="font-medium text-slate-800">{l.name}</span>
                                {l.niche || l.city ? <span className="ml-1 text-slate-400">· {[l.niche, l.city].filter(Boolean).join(" · ")}</span> : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button type="button" disabled={state === "saving" || (reason === "otro" && !comment.trim()) || (reassign && reassignEnabled && !targetLead)}
                  onClick={() => void submit("bad", {
                    rejectionReason: reason,
                    comment: reason === "otro" ? comment.trim() : REASON_OPTIONS.find((o) => o.value === reason)?.label,
                    ...(reassign && reassignEnabled && targetLead ? { reassignToLeadId: targetLead.id } : {}),
                  })}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  {state === "saving" ? "…" : "Marcar incorrecto"}
                </button>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

// ---------- Master-detail block ----------

interface ContactBlockProps {
  points: ContactPoint[];
  /** N69: id REAL del lead actual — point.id es el id del contact point, nunca un UUID. */
  leadId?: string;
  onFeedback?: FeedbackHandler;
  onToggleFavorite?: FavoriteHandler;
  onSearchLeads?: LeadSearchHandler;
}

export function ContactBlock({ points, leadId, onFeedback, onToggleFavorite, onSearchLeads }: ContactBlockProps) {
  const ordered = useMemo(() => sortPoints(points), [points]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Default: primer contacto vivo de mayor prioridad (nunca panel vacío).
  const defaultId = ordered.find((p) => !isDead(p))?.id ?? ordered[0]?.id ?? null;
  const activeId = selectedId && ordered.some((p) => p.id === selectedId) ? selectedId : defaultId;
  const selected = ordered.find((p) => p.id === activeId) ?? null;

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        No se encontraron contactos ni redes accionables para este lead.
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[340px_1fr] lg:items-start lg:gap-6">
      {/* Master */}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Contactos y redes"
        className="space-y-1 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
      >
        {ordered.map((point) => {
          const tier = classifyReliability(point.reliability);
          const dead = isDead(point);
          const isActive = point.id === activeId;
          return (
            <button
              key={point.id}
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => setSelectedId(point.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                isActive ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300",
                dead ? "opacity-50" : ""
              )}
            >
              <span className="text-base">{kindIcon(point.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-sm font-medium text-slate-800">{point.label}</span>
                  {point.favorite ? <span className="text-amber-500">★</span> : null}
                </span>
                <span className="block truncate text-xs text-slate-500">{point.value}</span>
              </span>
              {SOCIAL_KINDS.includes(point.kind) && point.activity ? (
                <span className={cn("h-2 w-2 rounded-full",
                  point.activity.activity_status === "active" ? "bg-emerald-500" : point.activity.activity_status === "abandoned" ? "bg-amber-500" : "bg-slate-300")} />
              ) : (
                <span className={cn("h-2 w-2 rounded-full", tier === "high" ? "bg-emerald-500" : tier === "medium" ? "bg-amber-500" : "bg-slate-300")} />
              )}
            </button>
          );
        })}
      </div>

      {/* Detail */}
      <div className="mt-4 lg:mt-0">
        {selected ? (
          <ContactDetail point={selected} leadId={leadId} onFeedback={onFeedback} onToggleFavorite={onToggleFavorite} onSearchLeads={onSearchLeads} />
        ) : null}
      </div>
    </div>
  );
}
