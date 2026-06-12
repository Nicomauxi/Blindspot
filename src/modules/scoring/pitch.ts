import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { getLeadInferredState, inferredTriState } from "./state.js";
import type { PitchHookOverrideWhen, PrimaryOffer } from "./types.js";

function overrideMatches(lead: Lead, when: PitchHookOverrideWhen): boolean {
  const state = getLeadInferredState(lead);
  // N09: tri-estado — 'unknown' nunca matchea (ni true ni false): sin evidencia se
  // cae al hook default, que no afirma hechos.
  if (when.has_delivery !== undefined && inferredTriState(state, "has_delivery") !== when.has_delivery) return false;
  if (when.has_pos !== undefined && inferredTriState(state, "has_pos") !== when.has_pos) return false;
  if (when.has_reservations !== undefined && inferredTriState(state, "has_reservations") !== when.has_reservations) return false;
  if (when.has_ecommerce !== undefined && inferredTriState(state, "has_ecommerce") !== when.has_ecommerce) return false;
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
