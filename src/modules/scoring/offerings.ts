export interface CommercialSignal {
  label: string;
  weight: "high" | "medium" | "low";
}

export interface CommercialOffering {
  id: string;
  label: string;
  description: string;
  score: number;
  confidence: "high" | "medium" | "low";
  signals: CommercialSignal[];
}

export interface CommercialOfferings {
  software: CommercialOffering[];
  marketing: CommercialOffering[];
  has_data: boolean;
}

export type CommercialOfferType = "software" | "marketing" | "both" | "unknown";

export interface CommercialOfferingsSummary {
  primary_offer_type: CommercialOfferType;
  software_score: number;
  marketing_score: number;
  top_software_offer: string | null;
  top_marketing_offer: string | null;
  top_software_label: string | null;
  top_marketing_label: string | null;
  evidence_count: number;
}

const OFFER_LABELS: Record<string, string> = {
  web_nuevo: "Sitio web nuevo",
  rediseno: "Rediseño de sitio web",
  software: "Sistema de gestión",
  catalogo: "Catálogo digital",
  marketing: "Marketing y redes sociales",
};

const OFFER_DESCRIPTIONS: Record<string, string> = {
  web_nuevo: "El negocio no tiene presencia web propia. Un sitio nuevo sería su primera vitrina digital.",
  rediseno: "El sitio actual tiene problemas técnicos o de diseño que reducen su efectividad.",
  software: "Hay oportunidades para digitalizar la gestión operativa del negocio.",
  catalogo: "El negocio puede mejorar cómo presenta sus productos o servicios en línea.",
  marketing: "El negocio tiene presencia web pero carece de estrategia en redes sociales.",
};

function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 55) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function hasTag(tags: string[], tag: string): boolean {
  return tags.includes(tag);
}

function buildWebNuevoSignals(tags: string[]): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  if (hasTag(tags, "no-website")) signals.push({ label: "No tiene sitio web", weight: "high" });
  if (hasTag(tags, "high-reviews-no-web")) signals.push({ label: "Buen rating sin sitio web propio", weight: "medium" });
  if (hasTag(tags, "fb-only-presence") || hasTag(tags, "ig-only-presence") || hasTag(tags, "social-link-only")) {
    signals.push({ label: "Solo presente en redes sociales", weight: "medium" });
  }
  return signals;
}

function buildRedisenoSignals(tags: string[]): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  if (hasTag(tags, "site-unreachable")) signals.push({ label: "Sitio web inaccesible", weight: "high" });
  if (hasTag(tags, "ssl-missing")) signals.push({ label: "Sin certificado HTTPS", weight: "medium" });
  if (hasTag(tags, "not-responsive")) signals.push({ label: "Sitio no adaptado a móviles", weight: "medium" });
  if (hasTag(tags, "stack-obsolete")) signals.push({ label: "Tecnología web obsoleta", weight: "medium" });
  if (hasTag(tags, "web-outdated")) signals.push({ label: "Contenido desactualizado", weight: "low" });
  if (hasTag(tags, "domain-old-stale")) signals.push({ label: "Dominio sin actividad", weight: "low" });
  return signals;
}

function buildSoftwareSignals(tags: string[]): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  if (hasTag(tags, "whatsapp-missing")) signals.push({ label: "Sin WhatsApp Business", weight: "medium" });
  if (hasTag(tags, "chat-widget-missing")) signals.push({ label: "Sin chat en el sitio", weight: "low" });
  return signals;
}

function buildCatalogoSignals(
  tags: string[],
  digitalFootprint: Record<string, unknown> | null
): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  const ops = isRecord(digitalFootprint?.["operational_systems"]) ? digitalFootprint!["operational_systems"] : null;
  if (ops) {
    if (Array.isArray(ops["ecommerce_platforms"]) && (ops["ecommerce_platforms"] as unknown[]).length === 0) {
      signals.push({ label: "Sin tienda online", weight: "high" });
    }
    if (Array.isArray(ops["menu_links"]) && (ops["menu_links"] as unknown[]).length === 0) {
      signals.push({ label: "Sin menú o catálogo digital", weight: "medium" });
    }
  }
  if (hasTag(tags, "hours-missing-on-web")) signals.push({ label: "Horarios no publicados online", weight: "low" });
  return signals;
}

function buildMarketingSignals(tags: string[]): CommercialSignal[] {
  const signals: CommercialSignal[] = [];
  if (hasTag(tags, "web-only-no-social")) signals.push({ label: "Sin presencia en redes sociales", weight: "high" });
  if (hasTag(tags, "fb-heuristic") && !hasTag(tags, "fb-confirmed") && !hasTag(tags, "fb-only-presence")) {
    signals.push({ label: "Facebook sin confirmar", weight: "medium" });
  }
  if (hasTag(tags, "ig-heuristic") && !hasTag(tags, "ig-confirmed") && !hasTag(tags, "ig-only-presence")) {
    signals.push({ label: "Instagram sin confirmar", weight: "medium" });
  }
  if (hasTag(tags, "pixel-missing")) signals.push({ label: "Sin pixel de seguimiento", weight: "low" });
  if (hasTag(tags, "analytics-missing")) signals.push({ label: "Sin Google Analytics", weight: "low" });
  return signals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractSubScore(subScores: Record<string, unknown>, key: string): number {
  const v = subScores[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

function makeOffering(
  id: string,
  score: number,
  signals: CommercialSignal[]
): CommercialOffering {
  return {
    id,
    label: OFFER_LABELS[id] ?? id,
    description: OFFER_DESCRIPTIONS[id] ?? "",
    score,
    confidence: confidenceFromScore(score),
    signals,
  };
}

export function buildCommercialOfferings(
  tags: string[],
  scoreBreakdown: Record<string, unknown> | null,
  digitalFootprint: Record<string, unknown> | null
): CommercialOfferings {
  const subScoresRaw = isRecord(scoreBreakdown?.["sub_scores"]) ? (scoreBreakdown!["sub_scores"] as Record<string, unknown>) : null;

  // If no scoring data and no tags, we can't derive offerings
  if (!subScoresRaw && tags.length === 0) {
    return { software: [], marketing: [], has_data: false };
  }

  const getScore = (key: string): number =>
    subScoresRaw ? extractSubScore(subScoresRaw, key) : 0;

  const softwareOfferings: CommercialOffering[] = [
    makeOffering("web_nuevo", getScore("web_nuevo"), buildWebNuevoSignals(tags)),
    makeOffering("rediseno", getScore("rediseno"), buildRedisenoSignals(tags)),
    makeOffering("software", getScore("software"), buildSoftwareSignals(tags)),
    makeOffering("catalogo", getScore("catalogo"), buildCatalogoSignals(tags, digitalFootprint)),
  ]
    .filter((o) => o.score > 0 || o.signals.length > 0)
    .sort((a, b) => b.score - a.score);

  const marketingScore = getScore("marketing");
  const marketingSignals = buildMarketingSignals(tags);
  const marketingOfferings: CommercialOffering[] =
    marketingScore > 0 || marketingSignals.length > 0
      ? [makeOffering("marketing", marketingScore, marketingSignals)]
      : [];

  const has_data = softwareOfferings.length > 0 || marketingOfferings.length > 0;

  return { software: softwareOfferings, marketing: marketingOfferings, has_data };
}

export function buildCommercialOfferingsSummary(
  offerings: CommercialOfferings
): CommercialOfferingsSummary {
  const topSoftware = offerings.software[0] ?? null;
  const topMarketing = offerings.marketing[0] ?? null;
  const softwareScore = topSoftware?.score ?? 0;
  const marketingScore = topMarketing?.score ?? 0;
  const hasSoftware = offerings.software.length > 0;
  const hasMarketing = offerings.marketing.length > 0;

  let primaryOfferType: CommercialOfferType = "unknown";
  if (hasSoftware && hasMarketing) primaryOfferType = "both";
  else if (hasSoftware) primaryOfferType = "software";
  else if (hasMarketing) primaryOfferType = "marketing";

  return {
    primary_offer_type: primaryOfferType,
    software_score: softwareScore,
    marketing_score: marketingScore,
    top_software_offer: topSoftware?.id ?? null,
    top_marketing_offer: topMarketing?.id ?? null,
    top_software_label: topSoftware?.label ?? null,
    top_marketing_label: topMarketing?.label ?? null,
    evidence_count:
      offerings.software.reduce((sum, offering) => sum + offering.signals.length, 0) +
      offerings.marketing.reduce((sum, offering) => sum + offering.signals.length, 0),
  };
}
