import type { DigitalFootprintEnriched, Lead } from "../../shared/types.js";
import { resolveField } from "./evaluator.js";
import type { PrimaryOffer, SubScores } from "./types.js";

function hasTag(lead: Lead, tag: string): boolean {
  return lead.tags.includes(tag);
}

function hasWeb(lead: Lead): boolean {
  return (
    hasTag(lead, "website-heuristic") ||
    hasTag(lead, "web-only-no-social") ||
    lead.website != null
  );
}

function getEnrichedFootprint(lead: Lead): DigitalFootprintEnriched | null {
  const fp = lead.digital_footprint;
  if (!fp) return null;
  if (fp.skipped === true) return null;
  if (fp.fetch_error) return null;
  return fp;
}

// Gracefully handles inferred_state from Fase F (not yet implemented — always false until then)
function inferredBool(lead: Lead, path: string): boolean {
  return resolveField(lead, `digital_footprint.inferred_state.${path}.value`) === true;
}

function scoreWebNuevo(lead: Lead): number {
  let score = 0;
  if (hasTag(lead, "no-website")) score += 35;
  if (hasTag(lead, "high-reviews-no-web")) score += 10;
  if (
    hasTag(lead, "fb-only-presence") ||
    hasTag(lead, "ig-only-presence") ||
    hasTag(lead, "social-link-only")
  ) {
    score += 15;
  }
  if (inferredBool(lead, "has_ecommerce")) score = Math.round(score * 0.3);
  return score;
}

function scoreRediseno(lead: Lead): number {
  if (!hasWeb(lead)) return 0;
  let score = 0;
  if (hasTag(lead, "site-unreachable")) score += 15;
  if (hasTag(lead, "ssl-missing")) score += 10;
  if (hasTag(lead, "not-responsive")) score += 10;
  if (hasTag(lead, "stack-obsolete")) score += 10;
  if (hasTag(lead, "web-outdated")) score += 8;
  if (hasTag(lead, "domain-old-stale")) score += 5;
  return score;
}

function scoreMarketing(lead: Lead): number {
  let score = 0;
  if (hasTag(lead, "web-only-no-social")) score += 28;
  if (
    hasTag(lead, "fb-heuristic") &&
    !hasTag(lead, "fb-confirmed") &&
    !hasTag(lead, "fb-only-presence")
  ) {
    score += 15;
  }
  if (
    hasTag(lead, "ig-heuristic") &&
    !hasTag(lead, "ig-confirmed") &&
    !hasTag(lead, "ig-only-presence")
  ) {
    score += 15;
  }
  if (hasTag(lead, "pixel-missing")) score += 5;
  if (hasTag(lead, "analytics-missing")) score += 5;
  return score;
}

function scoreSoftware(lead: Lead, sgScore: number): number {
  let score = sgScore;
  if (hasTag(lead, "whatsapp-missing")) score += 10;
  if (hasTag(lead, "chat-widget-missing")) score += 3;
  score = Math.min(100, score);
  if (inferredBool(lead, "has_reservations")) score = Math.round(score * 0.7);
  if (inferredBool(lead, "has_delivery")) score = Math.round(score * 0.8);
  return score;
}

function scoreCatalogo(lead: Lead): number {
  let score = 0;
  if (hasTag(lead, "hours-missing-on-web")) score += 3;
  const fp = getEnrichedFootprint(lead);
  const ops = fp?.operational_systems;
  if (ops != null) {
    // Array guards handle leads enriched before ecommerce_platforms/menu_links were added
    if (Array.isArray(ops.ecommerce_platforms) && ops.ecommerce_platforms.length === 0) score += 25;
    if (Array.isArray(ops.menu_links) && ops.menu_links.length === 0) score += 20;
    const niche = lead.niche ?? "other";
    if (niche === "restaurant" && Array.isArray(ops.menu_keywords) && ops.menu_keywords.length === 0) score += 15;
    else if (niche === "car_dealer" && Array.isArray(ops.catalog_keywords) && ops.catalog_keywords.length === 0) score += 15;
  }
  return score;
}

const OFFER_NAMES = [
  "web_nuevo",
  "rediseno",
  "marketing",
  "software",
  "catalogo",
] as const;
type OfferName = (typeof OFFER_NAMES)[number];

export function calculateSubScores(lead: Lead, sgScore: number): SubScores {
  const scores: Record<OfferName, number> = {
    web_nuevo: scoreWebNuevo(lead),
    rediseno: scoreRediseno(lead),
    marketing: scoreMarketing(lead),
    software: scoreSoftware(lead, sgScore),
    catalogo: scoreCatalogo(lead),
  };

  const maxScore = Math.max(...(Object.values(scores) as number[]));
  const primary_offer: PrimaryOffer =
    maxScore === 0
      ? "none"
      : (OFFER_NAMES.find((k) => scores[k] === maxScore) ?? "none");

  return { ...scores, primary_offer };
}
