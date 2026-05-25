"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type ContactPointKind = "whatsapp" | "phone" | "email" | "address" | "website" | "instagram" | "facebook";

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
}

type TypeFilter = "all" | "phone" | "email" | "social" | "web";
type ReliabilityFilter = "all" | "high" | "medium" | "low";

const TYPE_LABEL: Record<TypeFilter, string> = {
  all: "Todo",
  phone: "Teléfono",
  email: "Email",
  social: "Social",
  web: "Web/Dir.",
};

const TYPE_KINDS: Record<TypeFilter, ContactPointKind[]> = {
  all: ["whatsapp", "phone", "email", "address", "website", "instagram", "facebook"],
  phone: ["whatsapp", "phone"],
  email: ["email"],
  social: ["instagram", "facebook"],
  web: ["website", "address"],
};

const RELIABILITY_LABEL: Record<ReliabilityFilter, string> = {
  all: "Todas",
  high: "Alta",
  medium: "Media",
  low: "Baja/sin dato",
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

function reliabilityLabel(tier: "high" | "medium" | "low"): string {
  if (tier === "high") return "Alta";
  if (tier === "medium") return "Media";
  return "Baja";
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    google_places: "Google Places",
    yelu: "Yelu",
    pedidosya: "PedidosYa",
    mintur: "MINTUR",
    osm: "OSM",
    social_search: "Social",
    manual: "Manual",
    scoring_engine: "Motor",
    inference_engine: "Inferido",
  };
  return map[source] ?? source.replaceAll("_", " ");
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-sky-300 bg-sky-50 text-sky-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      )}
    >
      {label}
    </button>
  );
}

function ContactPointRow({ point }: { point: ContactPoint }) {
  const tier = classifyReliability(point.reliability);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{point.label}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", reliabilityClass(tier))}>
            {point.reliability != null ? `${Math.round(point.reliability * 100)}%` : reliabilityLabel(tier)}
          </span>
          {point.source ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
              {sourceLabel(point.source)}
            </span>
          ) : null}
        </div>
        <div className="mt-2 break-all text-sm font-medium text-slate-900">{point.value}</div>
        {point.note ? <div className="mt-1 text-xs text-slate-500">{point.note}</div> : null}
      </div>
      <div className="flex shrink-0 gap-2">
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
  );
}

interface ContactBlockProps {
  points: ContactPoint[];
}

export function ContactBlock({ points }: ContactBlockProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [reliabilityFilter, setReliabilityFilter] = useState<ReliabilityFilter>("all");

  const availableSources = useMemo(() => {
    const sources = new Set(points.map((p) => p.source).filter((s): s is string => Boolean(s)));
    return Array.from(sources).sort();
  }, [points]);

  const filtered = useMemo(() => {
    const allowedKinds = TYPE_KINDS[typeFilter];
    return points.filter((point) => {
      if (!allowedKinds.includes(point.kind)) return false;
      if (sourceFilter !== "all" && point.source !== sourceFilter) return false;
      if (reliabilityFilter !== "all") {
        const tier = classifyReliability(point.reliability);
        if (tier !== reliabilityFilter) return false;
      }
      return true;
    });
  }, [points, typeFilter, sourceFilter, reliabilityFilter]);

  const activeFilters = [
    typeFilter !== "all" ? 1 : 0,
    sourceFilter !== "all" ? 1 : 0,
    reliabilityFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  function clearFilters() {
    setTypeFilter("all");
    setSourceFilter("all");
    setReliabilityFilter("all");
  }

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        No se encontraron contactos accionables para este lead.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Tipo</span>
          {(["all", "phone", "email", "social", "web"] as TypeFilter[]).map((type) => (
            <FilterChip
              key={type}
              active={typeFilter === type}
              label={TYPE_LABEL[type]}
              onClick={() => setTypeFilter(type)}
            />
          ))}
        </div>

        {availableSources.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Fuente</span>
            <FilterChip active={sourceFilter === "all"} label="Todas" onClick={() => setSourceFilter("all")} />
            {availableSources.map((src) => (
              <FilterChip
                key={src}
                active={sourceFilter === src}
                label={sourceLabel(src)}
                onClick={() => setSourceFilter(src)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Fiabilidad</span>
          {(["all", "high", "medium", "low"] as ReliabilityFilter[]).map((tier) => (
            <FilterChip
              key={tier}
              active={reliabilityFilter === tier}
              label={RELIABILITY_LABEL[tier]}
              onClick={() => setReliabilityFilter(tier)}
            />
          ))}
        </div>

        {activeFilters > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{filtered.length} de {points.length} contactos</span>
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-sky-600 hover:underline">
              Limpiar filtros
            </button>
          </div>
        ) : null}
      </div>

      <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">
            Ningún dato coincide con los filtros activos.
          </div>
        ) : (
          filtered.map((point) => <ContactPointRow key={point.id} point={point} />)
        )}
      </div>
    </div>
  );
}
