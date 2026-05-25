"use client";

import type { CommercialOffering, CommercialOfferings } from "@/lib/api";
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

function OfferingCard({ offering }: { offering: CommercialOffering }) {
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
          {offering.signals.map((signal, idx) => (
            <li key={idx} className="flex items-center gap-2 text-xs text-slate-700">
              <span className={cn("text-[10px]", SIGNAL_WEIGHT_CLASS[signal.weight])}>
                {SIGNAL_WEIGHT_ICON[signal.weight]}
              </span>
              {signal.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface CommercialSummaryProps {
  offerings: CommercialOfferings | null;
  leadName: string;
  onEnrich?: () => void;
}

export function CommercialSummary({ offerings, leadName, onEnrich }: CommercialSummaryProps) {
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
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">Software</span>
          <span className="text-xs text-slate-500">Productos digitales</span>
        </div>
        {topSoftware.length > 0 ? (
          <div className="space-y-3">
            {topSoftware.map((offering) => (
              <OfferingCard key={offering.id} offering={offering} />
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
              <OfferingCard key={offering.id} offering={offering} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
            Sin señales de oportunidades de marketing.
          </div>
        )}
      </div>
    </div>
  );
}
