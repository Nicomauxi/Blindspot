import type { Lead } from "../../shared/types.js";
import type { UrgencySignal } from "./types.js";
import { computeSocialSignal } from "./social-signal.js";

const OUTDATED_YEAR_THRESHOLD = 2020;
const GROWING_REVIEW_THRESHOLD = 20;
const GROWING_RATING_MIN = 4.0;
// N01: unificado con urgency-profile.ts — 'hospedaje' no existe como niche (0 leads), el real es 'accommodation'.
const TOURIST_NICHES = new Set(["restaurant", "hospedaje", "accommodation"]);
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

  // N01: 'recently_discovered' eliminado — era frescura del DATO, no urgencia del
  // negocio, y degeneraba la señal (97,3% medium). La frescura vive en freshness_signal.

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

  // F1: presencia social ACTIVA = negocio operando y alcanzable ahora → urgency media.
  if (computeSocialSignal(lead).active) {
    mediumSignals.push("social_activa");
  }

  if (highSignals.length > 0) return "high";
  if (mediumSignals.length > 0) return "medium";
  return "low";
}
