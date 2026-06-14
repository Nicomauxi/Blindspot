import type { Lead } from "../../shared/types.js";
import type { SocialScoringConfig } from "./types.js";

// Señal social derivada del enrichment (F1: social_activity de IG vía Serper/SearXNG).
// Pura, defensiva ante datos ausentes/mal formados.
export interface SocialSignal {
  has_presence: boolean;
  audience_tier: "low" | "medium" | "high" | null;
  active: boolean;
  /** audiencia alta + sin web = prospecto ideal de web_nuevo/marketing. */
  high_audience_no_web: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function computeSocialSignal(lead: Lead): SocialSignal {
  const none: SocialSignal = { has_presence: false, audience_tier: null, active: false, high_audience_no_web: false };
  const fp = lead.digital_footprint;
  if (!isRecord(fp)) return none;
  const sa = (fp as Record<string, unknown>)["social_activity"];
  if (!isRecord(sa)) return none;
  const summary = isRecord(sa["summary"]) ? sa["summary"] : null;
  if (!summary) return none;

  const tierRaw = summary["audience_tier"];
  const audience_tier = tierRaw === "low" || tierRaw === "medium" || tierRaw === "high" ? tierRaw : null;
  const activePlatforms = Array.isArray(summary["active_platforms"]) ? summary["active_platforms"] : [];
  const signals = Array.isArray(summary["commercial_signals"]) ? (summary["commercial_signals"] as unknown[]) : [];

  return {
    has_presence: summary["has_social_presence"] === true,
    audience_tier,
    active: activePlatforms.length > 0,
    high_audience_no_web: signals.includes("alta_audiencia_sin_web"),
  };
}

// Bonus aditivo (conservador) que entra al prospect_score, análogo a source_quality_bonus.
export function computeSocialBonus(signal: SocialSignal, config: SocialScoringConfig | undefined): number {
  if (!config) return 0;
  let bonus = 0;
  if (signal.audience_tier) bonus += config.audience_bonus[signal.audience_tier];
  if (signal.active) bonus += config.active_bonus;
  if (signal.high_audience_no_web) bonus += config.high_audience_no_web_bonus;
  return Math.round(bonus);
}
