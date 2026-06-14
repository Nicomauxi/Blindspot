import type { Lead } from "../../shared/types.js";
import { getScoringConfig } from "./config.js";
import { topSignalForOffer } from "./offerings.js";
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

function resolveTemplate(lead: Lead, primaryOffer: Exclude<PrimaryOffer, "none">): string {
  const config = getScoringConfig();
  const hookConfig = config.pitch_hooks[primaryOffer];
  for (const override of hookConfig.overrides ?? []) {
    if (overrideMatches(lead, override.when)) return override.text;
  }
  return hookConfig.default;
}

function leadDigitalFootprint(lead: Lead): Record<string, unknown> | null {
  const fp = (lead as { digital_footprint?: unknown }).digital_footprint;
  return fp && typeof fp === "object" && !Array.isArray(fp) ? (fp as Record<string, unknown>) : null;
}

// M2: el pitch_hook era 1 de 8 plantillas idénticas para 3194 leads. Ahora teje el
// nombre del negocio y la evidencia concreta observada (misma fuente que las offerings
// de la UI) para que el vendedor vea un motivo específico, no una frase de catálogo.
export function computePitchHook(lead: Lead, primaryOffer: PrimaryOffer): string {
  if (primaryOffer === "none") {
    return "Lead sin hook comercial claro; revisar manualmente.";
  }

  const template = resolveTemplate(lead, primaryOffer);
  const name = (lead.name ?? "").trim();
  const evidence = topSignalForOffer(primaryOffer, lead.tags ?? [], leadDigitalFootprint(lead));

  const prefix = name ? `${name}: ` : "";
  const suffix = evidence ? ` Señal: ${evidence.label.toLowerCase()}.` : "";
  return `${prefix}${template}${suffix}`;
}
