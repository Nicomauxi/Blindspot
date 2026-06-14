"use client";

import type { CommercialOffering, CommercialOfferings } from "@/lib/api";
import { cn } from "@/lib/utils";

// Previsualización compacta de las barras de ofertas (mismo lenguaje visual que "Análisis comercial"
// en la ficha), para mostrar en TODOS los listados de leads + el "por qué" de la oferta top.

const OFFER_KIND_DOT: Record<"software" | "marketing", string> = {
  software: "bg-emerald-500",
  marketing: "bg-violet-500",
};

const OFFER_KIND_LABEL: Record<"software" | "marketing", string> = {
  software: "SW",
  marketing: "MKT",
};

const SIGNAL_WEIGHT_ICON: Record<string, string> = { high: "●", medium: "◑", low: "○" };
const SIGNAL_WEIGHT_CLASS: Record<string, string> = {
  high: "text-rose-600",
  medium: "text-amber-600",
  low: "text-slate-400",
};

type RankedOffering = CommercialOffering & { kind: "software" | "marketing" };

function rankOfferings(offerings: CommercialOfferings, max: number): RankedOffering[] {
  const merged: RankedOffering[] = [
    ...offerings.software.map((o) => ({ ...o, kind: "software" as const })),
    ...offerings.marketing.map((o) => ({ ...o, kind: "marketing" as const })),
  ];
  return merged
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

function MiniScoreBar({ score }: { score: number }) {
  const clamped = Math.min(100, Math.max(0, score));
  const color = clamped >= 55 ? "bg-emerald-500" : clamped >= 20 ? "bg-amber-400" : "bg-slate-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{clamped}</span>
    </div>
  );
}

interface OfferBarsPreviewProps {
  offerings?: CommercialOfferings | null;
  /** Pitch/“por qué” de alto nivel ya disponible en el lead (fallback). */
  pitchHook?: string | null;
  /** Cantidad de ofertas a mostrar (default 3). */
  max?: number;
  className?: string;
}

export function OfferBarsPreview({ offerings, pitchHook, max = 3, className }: OfferBarsPreviewProps) {
  const ranked = offerings?.has_data ? rankOfferings(offerings, max) : [];

  if (ranked.length === 0) {
    // Sin ofertas derivadas: al menos exponemos el pitch hook si existe (no inventamos barras).
    if (!pitchHook) return null;
    return (
      <div className={cn("mt-3", className)}>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Por qué</div>
        <p className="mt-1 text-xs text-slate-600">{pitchHook}</p>
      </div>
    );
  }

  const topOffer = ranked[0];

  return (
    <div className={cn("mt-3", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ofertas sugeridas</div>
      <div className="mt-1.5 space-y-1.5">
        {ranked.map((offering) => (
          <div key={`${offering.kind}::${offering.id}`} className="flex items-center gap-2">
            <span
              title={OFFER_KIND_LABEL[offering.kind]}
              className={cn("h-2 w-2 shrink-0 rounded-full", OFFER_KIND_DOT[offering.kind])}
            />
            <span className="w-28 shrink-0 truncate text-[11px] font-medium text-slate-700" title={offering.label}>
              {offering.label}
            </span>
            <MiniScoreBar score={offering.score} />
          </div>
        ))}
      </div>
      {topOffer && (topOffer.signals.length > 0 || pitchHook) ? (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-sky-600 hover:underline">
            Por qué
          </summary>
          <div className="mt-1.5 space-y-1 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
            {pitchHook ? <p className="text-[11px] text-slate-600">{pitchHook}</p> : null}
            {topOffer.signals.length > 0 ? (
              <ul className="space-y-0.5">
                {topOffer.signals.slice(0, 4).map((signal, index) => (
                  <li key={`${signal.label}::${index}`} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className={cn("text-[9px]", SIGNAL_WEIGHT_CLASS[signal.weight])}>
                      {SIGNAL_WEIGHT_ICON[signal.weight]}
                    </span>
                    {signal.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
