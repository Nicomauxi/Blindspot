import type { Lead } from "../../shared/types.js";
import type { UrgencySignal } from "./types.js";

const OUTDATED_YEAR_THRESHOLD = 2020;
const RECENTLY_DISCOVERED_DAYS = 90;
const GROWING_REVIEW_THRESHOLD = 20;
const GROWING_RATING_MIN = 4.0;
const TOURIST_NICHES = new Set(["restaurant", "hospedaje"]);
const TOURIST_ZONES = [
  "punta del este",
  "rocha",
  "cabo polonio",
  "piriápolis",
  "barra de valizas",
];

export function computeUrgencySignal(lead: Lead): UrgencySignal {
  const highSignals: string[] = [];
  const mediumSignals: string[] = [];

  // Alta urgencia: web desactualizada
  const fp = lead.digital_footprint;
  const copyrightYear =
    fp && !("skipped" in fp) ? fp.copyright_year ?? null : null;
  if (typeof copyrightYear === "number" && copyrightYear <= OUTDATED_YEAR_THRESHOLD) {
    highSignals.push("copyright_year_old");
  }

  // Alta urgencia: zona turística estacional
  const niche = lead.niche ?? "other";
  const address = (lead.address ?? "").toLowerCase();
  if (
    TOURIST_NICHES.has(niche) &&
    TOURIST_ZONES.some((z) => address.includes(z))
  ) {
    highSignals.push("tourist_zone_seasonal");
  }

  // Media urgencia: negocio nuevo en el radar
  if (lead.created_at) {
    const daysSince =
      (Date.now() - new Date(lead.created_at).getTime()) / 86_400_000;
    if (daysSince < RECENTLY_DISCOVERED_DAYS) {
      mediumSignals.push("recently_discovered");
    }
  }

  // Media urgencia: negocio joven en crecimiento
  const reviewCount = lead.review_count;
  const rating = lead.rating != null ? Number(lead.rating) : null;
  if (
    reviewCount !== null &&
    reviewCount < GROWING_REVIEW_THRESHOLD &&
    rating !== null &&
    rating >= GROWING_RATING_MIN
  ) {
    mediumSignals.push("growing_business");
  }

  if (highSignals.length > 0) return "high";
  if (mediumSignals.length > 0) return "medium";
  return "low";
}
