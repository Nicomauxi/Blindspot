"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getLead, listOutreach, generateOffer, getOwnerGroup, type LeadDetail, type OutreachEntry, type OfferPackage, type OwnerGroupMember } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatRelative } from "@/lib/utils";

const TIER_COLORS: Record<string, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-gray-100 text-gray-700",
  X: "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  contacted: "bg-blue-50 text-blue-700",
  responded: "bg-purple-50 text-purple-700",
  interested: "bg-yellow-50 text-yellow-700",
  closed_won: "bg-green-50 text-green-700",
  closed_lost: "bg-red-50 text-red-700",
  no_response: "bg-gray-50 text-gray-600",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm py-0.5">
      <span className="text-gray-400 w-36 shrink-0">{label}</span>
      <span className="text-gray-800 font-medium">{value ?? "—"}</span>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = useAuthStore((s) => s.token);
  const router = useRouter();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [outreach, setOutreach] = useState<OutreachEntry[]>([]);
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferPackage | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerChannel, setOfferChannel] = useState("whatsapp");
  const [offerCopied, setOfferCopied] = useState(false);

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

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Cargando...</div>;
  if (error) return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-3 text-sm">
      {error}
    </div>
  );
  if (!lead) return null;

  const inferredState = lead.inferred_state as Record<string, { value: boolean; confidence: number }> | null;
  const breakdown = lead.score_breakdown as Record<string, unknown> | null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">
          ← Volver
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{lead.name}</h1>
        {lead.contact_tier && (
          <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", TIER_COLORS[lead.contact_tier] ?? "bg-gray-100")}>
            Tier {lead.contact_tier}
          </span>
        )}
        {lead.prospect_score != null && (
          <span className="text-sm font-mono font-semibold text-gray-700">
            Score {lead.prospect_score}
          </span>
        )}
        {ownerGroup.length > 0 && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
            {ownerGroup.length + 1} negocios del mismo propietario
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Section title="Información básica">
            <KV label="Niche" value={lead.niche} />
            <KV label="Fuente" value={lead.source} />
            <KV label="Dirección" value={lead.address} />
            <KV label="Teléfono" value={lead.phone} />
            <KV label="WhatsApp" value={lead.whatsapp} />
            <KV label="Website" value={
              lead.website
                ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate max-w-xs inline-block">{lead.website}</a>
                : null
            } />
            <KV label="Rating" value={lead.rating != null ? `${lead.rating} ★ (${lead.review_count ?? 0} reseñas)` : null} />
            <KV label="Estado lead" value={lead.state} />
            <KV label="Fuentes corroboradoras" value={
              lead.corroborating_sources?.length > 0
                ? lead.corroborating_sources.map((s) => s.source).join(", ")
                : null
            } />
          </Section>

          <Section title="Scoring">
            <KV label="Prospect score" value={lead.prospect_score} />
            <KV label="Oferta principal" value={lead.primary_offer} />
            <KV label="Pitch hook" value={lead.pitch_hook} />
            <KV label="Urgencia" value={lead.urgency_signal} />
            <KV label="Confianza datos" value={lead.data_confidence_score != null ? `${(lead.data_confidence_score * 100).toFixed(0)}%` : null} />
            <KV label="Confianza contacto" value={lead.source_confidence != null ? `${(lead.source_confidence * 100).toFixed(0)}%` : null} />
          </Section>
        </div>

        <div>
          {inferredState && (
            <Section title="Estado inferido">
              {Object.entries(inferredState)
                .filter(([k]) => k !== "computed_at" && k !== "digitalization_level")
                .map(([k, v]) => {
                  if (typeof v !== "object" || v === null) return null;
                  return (
                    <KV
                      key={k}
                      label={k}
                      value={
                        <span className={v.value ? "text-green-700" : "text-gray-400"}>
                          {v.value ? "Sí" : "No"} ({Math.round((v.confidence ?? 0) * 100)}%)
                        </span>
                      }
                    />
                  );
                })}
              {inferredState["digitalization_level"] != null && (
                <KV label="Digitalización" value={String(inferredState["digitalization_level"])} />
              )}
            </Section>
          )}

          {lead.tags?.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {lead.tags.map((t) => (
                  <span key={t} className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </Section>
          )}

          {lead.notes && (
            <Section title="Notas">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{lead.notes}</p>
            </Section>
          )}

          {breakdown && (
            <Section title="Score breakdown">
              <pre className="text-xs text-gray-600 overflow-auto max-h-48 bg-gray-50 rounded p-2">
                {JSON.stringify({ sub_scores: (breakdown as any).sub_scores, primary_offer: (breakdown as any).primary_offer }, null, 2)}
              </pre>
            </Section>
          )}
        </div>
      </div>

      {/* Generate offer */}
      <Section title="Generar oferta">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select
            value={offerChannel}
            onChange={(e) => setOfferChannel(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="phone">Teléfono</option>
          </select>
          <button
            onClick={async () => {
              if (!token || !lead) return;
              setOfferLoading(true);
              setOffer(null);
              try {
                const res = await generateOffer(token, { lead_id: lead.id, channel: offerChannel });
                setOffer(res.data);
              } catch {
                // ignore — show error inline if needed
              } finally {
                setOfferLoading(false);
              }
            }}
            disabled={offerLoading}
            className="bg-brand-600 text-white rounded px-3 py-1 text-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {offerLoading ? "Generando..." : "Generar oferta"}
          </button>
        </div>
        {offer && (
          <div className="bg-gray-50 rounded p-3 text-sm">
            <p className="text-gray-800 whitespace-pre-wrap mb-2">{offer.text}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(offer.text);
                  setOfferCopied(true);
                  setTimeout(() => setOfferCopied(false), 2000);
                }}
                className="text-xs text-brand-600 hover:underline"
              >
                {offerCopied ? "¡Copiado!" : "Copiar"}
              </button>
              <span className="text-xs text-gray-400">
                via {offer.provider ?? offer.source_llm} · {offer.model ?? ""}
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* Owner group */}
      {ownerGroup.length > 0 && (
        <Section title={`Mismo propietario (${ownerGroup.length} lead${ownerGroup.length > 1 ? "s" : ""})`}>
          <div className="space-y-1">
            {ownerGroup.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <Link href={`/admin/leads/${m.id}`} className="text-brand-600 hover:underline font-medium flex-1 truncate">
                  {m.name}
                </Link>
                {m.niche && <span className="text-gray-400 text-xs">{m.niche}</span>}
                {m.contact_tier && (
                  <span className={cn("px-1.5 py-0.5 rounded text-xs font-semibold", TIER_COLORS[m.contact_tier] ?? "bg-gray-100")}>
                    {m.contact_tier}
                  </span>
                )}
                {m.prospect_score != null && (
                  <span className="text-xs font-mono text-gray-600">{m.prospect_score}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Outreach history */}
      <Section title={`Outreach (${outreach.length})`}>
        {outreach.length === 0 ? (
          <p className="text-sm text-gray-400">Sin contactos registrados</p>
        ) : (
          <div className="space-y-2">
            {outreach.map((o) => (
              <div key={o.id} className="flex items-start gap-3 text-sm border-b pb-2 last:border-0">
                <div className="shrink-0 mt-0.5">
                  <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", STATUS_COLORS[o.status] ?? "bg-gray-50 text-gray-600")}>
                    {o.status}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex gap-2 text-gray-700">
                    <span className="font-medium">{o.channel}</span>
                    {o.offer_type && <span className="text-gray-400">· {o.offer_type}</span>}
                    {o.outcome && <span className="text-gray-400">· {o.outcome}</span>}
                    {o.price_sold != null && <span className="text-green-700 font-medium">UYU {o.price_sold.toLocaleString()}</span>}
                  </div>
                  {o.notes && <p className="text-gray-500 text-xs truncate">{o.notes}</p>}
                </div>
                <span className="text-xs text-gray-400 shrink-0">{formatRelative(o.contacted_at)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <Link href={`/admin/outreach?lead_id=${lead.id}`} className="text-xs text-brand-600 hover:underline">
            Ver todos los outreach →
          </Link>
        </div>
      </Section>
    </div>
  );
}
