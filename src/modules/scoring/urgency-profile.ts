import type { Lead } from "../../shared/types.js";
import type { UrgencySignal } from "./types.js";
import { computeSocialSignal } from "./social-signal.js";
import { stripDiacritics } from "../discovery/location.js";

const OUTDATED_YEAR_THRESHOLD = 2020;
const TOURIST_NICHES = new Set(["restaurant", "accommodation"]);
const TOURIST_ZONES = [
  "punta del este",
  "rocha",
  "cabo polonio",
  "piriapolis",
  "barra de valizas",
];

export type FreshnessSignal = "fresh" | "stale" | "neutral";

export interface UrgencyProfile {
  business_urgency_signal: UrgencySignal;
  freshness_signal: FreshnessSignal;
  days_in_pool: number;
}

export function computeUrgencyProfile(lead: Lead): UrgencyProfile {
  const fp = lead.digital_footprint;
  const copyrightYear = fp && !("skipped" in fp) ? fp.copyright_year ?? null : null;
  const address = stripDiacritics(lead.address ?? "").toLowerCase();
  const niche = lead.niche ?? "other";

  let business: UrgencySignal = "low";
  if (typeof copyrightYear === "number" && copyrightYear <= OUTDATED_YEAR_THRESHOLD) {
    business = "high";
  } else if (
    TOURIST_NICHES.has(niche) &&
    TOURIST_ZONES.some((zone) => address.includes(zone))
  ) {
    business = "high";
  } else if (
    lead.tags.includes("site-unreachable") ||
    lead.tags.includes("web-outdated") ||
    lead.tags.includes("domain-old-stale") ||
    lead.tags.includes("not-responsive")
  ) {
    business = "medium";
  }

  // F1: un negocio con presencia social ACTIVA está operando y es alcanzable ahora →
  // buen momento para contactar. Lifta a 'medium' (no pisa un 'high' ya detectado). Ataca
  // la degeneración del urgency_signal (90% 'low') con dato medido, no heurística de zona.
  if (business === "low" && computeSocialSignal(lead).active) {
    business = "medium";
  }

  const daysInPool = Math.max(0, Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86_400_000));
  let freshness: FreshnessSignal = "neutral";
  if (daysInPool < 7) freshness = "fresh";
  else if (daysInPool > 90) freshness = "stale";

  return {
    business_urgency_signal: business,
    freshness_signal: freshness,
    days_in_pool: daysInPool,
  };
}
