import type { Lead } from "../../shared/types.js";
import { getDiscoveryConfig } from "../discovery/config.js";
import { isSocialOrMissingWeb } from "../discovery/filters.js";

export type ChannelDecision = "confirmed" | "heuristic" | "missing";

export interface EnrichmentChannels {
  website:   { decision: ChannelDecision };
  facebook:  { decision: ChannelDecision };
  instagram: { decision: ChannelDecision };
  whatsapp:  { decision: ChannelDecision };
  email:     { decision: ChannelDecision };
}

export function shouldSkip(c: { decision: ChannelDecision }): boolean {
  return c.decision === "confirmed";
}

export function anyMissing(ch: EnrichmentChannels): boolean {
  return Object.values(ch).some((c) => c.decision !== "confirmed");
}

const WEBSITE_HEURISTIC_CONFIRMED_THRESHOLD = 0.7;

export function detectConfirmedChannels(lead: Lead): EnrichmentChannels {
  const tags = new Set(lead.tags);
  const fp = lead.digital_footprint;
  const socialDomains = getDiscoveryConfig().social_domains;

  let websiteDecision: ChannelDecision;
  if (lead.website && !isSocialOrMissingWeb(lead.website, socialDomains)) {
    websiteDecision = "confirmed";
  } else if (tags.has("website-heuristic")) {
    const heuristicScore = fp?.heuristic_discovery?.selected?.website?.score ?? 0;
    websiteDecision = heuristicScore >= WEBSITE_HEURISTIC_CONFIRMED_THRESHOLD
      ? "confirmed"
      : "heuristic";
  } else {
    websiteDecision = "missing";
  }

  const facebookDecision: ChannelDecision = tags.has("fb-confirmed")
    ? "confirmed"
    : tags.has("fb-heuristic")
    ? "heuristic"
    : "missing";

  const instagramDecision: ChannelDecision = tags.has("ig-confirmed")
    ? "confirmed"
    : tags.has("ig-heuristic")
    ? "heuristic"
    : "missing";

  const whatsappDecision: ChannelDecision = tags.has("whatsapp-confirmed")
    ? "confirmed"
    : tags.has("whatsapp-derived")
    ? "heuristic"
    : "missing";

  return {
    website:   { decision: websiteDecision },
    facebook:  { decision: facebookDecision },
    instagram: { decision: instagramDecision },
    whatsapp:  { decision: whatsappDecision },
    email:     { decision: "missing" },
  };
}
