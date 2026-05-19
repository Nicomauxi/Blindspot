import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { getLeadInferredState, inferredBool } from "./state.js";
import type { PitchHookOverrideWhen, PrimaryOffer } from "./types.js";

function overrideMatches(lead: Lead, when: PitchHookOverrideWhen): boolean {
  const state = getLeadInferredState(lead);
  if (when.has_delivery !== undefined && inferredBool(state, "has_delivery") !== when.has_delivery) return false;
  if (when.has_pos !== undefined && inferredBool(state, "has_pos") !== when.has_pos) return false;
  if (when.has_reservations !== undefined && inferredBool(state, "has_reservations") !== when.has_reservations) return false;
  if (when.has_ecommerce !== undefined && inferredBool(state, "has_ecommerce") !== when.has_ecommerce) return false;
  if (when.niche !== undefined && (lead.niche ?? "other") !== when.niche) return false;
  return true;
}

export function computePitchHook(lead: Lead, primaryOffer: PrimaryOffer): string {
  if (primaryOffer === "none") {
    return "Lead sin hook comercial claro; revisar manualmente.";
  }

  const config = getScoringConfig();
  const hookConfig = config.pitch_hooks[primaryOffer];

  for (const override of hookConfig.overrides ?? []) {
    if (overrideMatches(lead, override.when)) {
      return override.text;
    }
  }

  return hookConfig.default;
}
