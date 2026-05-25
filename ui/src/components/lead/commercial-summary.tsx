"use client";

import type { CommercialEvidenceNode, CommercialOffering, CommercialOfferings } from "@/lib/api";
import { cn } from "@/lib/utils";

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const SIGNAL_WEIGHT_ICON: Record<string, string> = {
  high: "●",
  medium: "◑",
  low: "○",
};

const SIGNAL_WEIGHT_CLASS: Record<string, string> = {
  high: "text-rose-600",
  medium: "text-amber-600",
  low: "text-slate-400",
};

const STRENGTH_CLASS: Record<string, string> = {
  high: "text-emerald-700",
  medium: "text-amber-700",
  low: "text-slate-500",
};

const OFFERING_EVIDENCE_KEYS: Record<string, string[]> = {
  web_nuevo: ["offer", "urgency"],
  rediseno: ["offer", "urgency"],
  software: ["offer", "urgency"],
  catalogo: ["offer", "contact"],
  marketing: ["contact", "urgency"],
};

function ScoreBar({ score }: { score: number }) {
  const clamped = Math.min(100, Math.max(0, score));
  const color = clamped >= 55 ? "bg-emerald-500" : clamped >= 20 ? "bg-amber-400" : "bg-slate-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-7 text-right text-xs tabular-nums text-slate-600">{clamped}</span>
    </div>
  );
}

function EvidenceNodeInline({ node }: { node: CommercialEvidenceNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">{node.title}</span>
        <span className={cn("text-[10px] font-semibold uppercase", STRENGTH_CLASS[node.strength])}>
          {node.strength}
        </span>
      </div>
      <p className="text-xs text-slate-600">{node.summary}</p>
      {node.evidence.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {node.evidence.map((item) => (
            <li key={item} className="text-xs text-slate-500">· {item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OfferingCard({
  offering,
  evidenceTree,
}: {
  offering: CommercialOffering;
  evidenceTree: CommercialEvidenceNode[];
}) {
  const relevantKeys = OFFERING_EVIDENCE_KEYS[offering.id] ?? ["offer"];
  const relevantNodes = evidenceTree.filter((node) => relevantKeys.includes(node.id));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{offering.label}</p>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", CONFIDENCE_BADGE[offering.confidence])}>
          {CONFIDENCE_LABEL[offering.confidence]}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{offering.description}</p>
      <div className="mt-3">
        <ScoreBar score={offering.score} />
      </div>
      {offering.signals.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {offering.signals.map((signal) => (
            <li key={signal.label} className="flex items-center gap-2 text-xs text-slate-700">
              <span className={cn("text-[10px]", SIGNAL_WEIGHT_CLASS[signal.weight])}>
                {SIGNAL_WEIGHT_ICON[signal.weight]}
              </span>
              {signal.label}
            </li>
          ))}
        </ul>
      ) : null}
      {relevantNodes.length > 0 ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-xs font-medium text-sky-600 hover:underline">
            Ver por qué
          </summary>
          <div className="mt-2 space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            {relevantNodes.map((node) => (
              <EvidenceNodeInline key={node.id} node={node} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

interface CommercialSummaryProps {
  offerings: CommercialOfferings | null;
  leadName: string;
  evidenceTree?: CommercialEvidenceNode[];
  onEnrich?: () => void;
}

export function CommercialSummary({ offerings, leadName, evidenceTree = [], onEnrich }: CommercialSummaryProps) {
  if (!offerings || !offerings.has_data) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
        <p className="text-sm font-medium text-slate-700">Necesitamos enriquecer este lead para sugerir ofertas</p>
        <p className="mt-1 text-xs text-slate-500">
          {leadName} no tiene suficiente información para derivar recomendaciones comerciales.
        </p>
        {onEnrich ? (
          <button
            type="button"
            onClick={onEnrich}
            className="mt-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100"
          >
            Enriquecer ahora
          </button>
        ) : null}
      </div>
    );
  }

  const topSoftware = offerings.software.slice(0, 4);
  const topMarketing = offerings.marketing.slice(0, 2);

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">Software</span>
            <span className="text-xs text-slate-500">Productos digitales</span>
          </div>
          {topSoftware.length > 0 ? (
            <div className="space-y-3">
              {topSoftware.map((offering) => (
                <OfferingCard key={offering.id} offering={offering} evidenceTree={evidenceTree} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
              Sin señales de oportunidades de software.
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">Marketing</span>
            <span className="text-xs text-slate-500">Redes sociales y ads</span>
          </div>
          {topMarketing.length > 0 ? (
            <div className="space-y-3">
              {topMarketing.map((offering) => (
                <OfferingCard key={offering.id} offering={offering} evidenceTree={evidenceTree} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
              Sin señales de oportunidades de marketing.
            </div>
          )}
        </div>
      </div>

      {evidenceTree.length > 0 ? (
        <details>
          <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 hover:text-slate-700">
            Ver traza completa
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {evidenceTree.map((node) => (
              <div key={node.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{node.title}</div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{node.summary}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", node.strength === "high" ? "bg-emerald-100 text-emerald-700" : node.strength === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>
                    {node.strength}
                  </span>
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
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
