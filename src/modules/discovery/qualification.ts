import type { DiscoveryCandidate, DiscoverySource, Lead } from "../../shared/types.js";
import type { Vertical } from "./vertical.js";

// Fuentes que solo aportan valor como SEÑAL al corroborar otro lead (no como lead standalone).
// SoT en shared/discovery-sources.ts (derivado de signalOnly); se re-exporta por compat.
export { SIGNAL_ONLY_SOURCES } from "../../shared/discovery-sources.js";
import { SIGNAL_ONLY_SOURCES } from "../../shared/discovery-sources.js";

export interface QualificationInput {
  source: DiscoverySource;
  hasContact: boolean;
  corroborated: boolean;
  /** El negocio está fuera de Uruguay (AR/BR). Excluye del pool aun si corrobora. F1.3. */
  foreign?: boolean;
  /**
   * Vertical de negocio (DEI por CIIU). Solo "comercio-local" es ICP comercial;
   * "industrial"/"otro" se segmentan como vertical B2B y NO entran al pool comercial. F1.4.
   * undefined = la fuente no tiene vertical (no se aplica el gate).
   */
  vertical?: Vertical;
}

export interface QualificationResult {
  passed_filter: boolean;
  rejection_reasons: string[];
}

// Gate de calidad para leads de fuentes externas. No usa rating/reviews (que los
// externos no tienen): se basa en accionabilidad comercial.
// Regla de negocio: "tiene teléfono pero no web" ES el target (brecha digital) → pasa.
// Solo se descarta lo inaccionable (sin ningún canal de contacto) y las fuentes-señal
// que no corroboran a nadie.
export function qualifyExternalLead(input: QualificationInput): QualificationResult {
  // Fuera de Uruguay → nunca entra al pool, ni siquiera corroborado (F1.3).
  if (input.foreign) {
    return { passed_filter: false, rejection_reasons: ["geo-out-of-country"] };
  }

  // Vertical B2B (industrial/otro) → segmentada fuera del pool comercial, aun corroborada. F1.4.
  if (input.vertical && input.vertical !== "comercio-local") {
    return { passed_filter: false, rejection_reasons: ["non-commercial-vertical"] };
  }

  const rejection_reasons: string[] = [];
  // F5.2: sin canal de contacto accionable no hay pool, ni corroborado — un negocio
  // confirmado real al que no se le puede escribir/llamar no es vendible.
  if (!input.hasContact) {
    rejection_reasons.push("no-contact");
  }
  // Un lead corroborado por otra fuente (y contactable) es un negocio real confirmado → pasa.
  if (input.corroborated) {
    return { passed_filter: rejection_reasons.length === 0, rejection_reasons };
  }
  if (SIGNAL_ONLY_SOURCES.has(input.source)) {
    rejection_reasons.push("signal-source-only");
  }

  return { passed_filter: rejection_reasons.length === 0, rejection_reasons };
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalHasValue(canonicalFields: Lead["canonical_fields"], field: "phone" | "website" | "email"): boolean {
  if (!canonicalFields || typeof canonicalFields !== "object") return false;
  const raw = (canonicalFields as Record<string, unknown>)[field];
  if (nonEmpty(raw)) return true;
  if (raw && typeof raw === "object" && "value" in raw) {
    return nonEmpty((raw as { value: unknown }).value);
  }
  return false;
}

// ¿El candidato (al insertar) trae algún canal de contacto?
export function candidateHasContact(candidate: DiscoveryCandidate): boolean {
  return nonEmpty(candidate.phone) || nonEmpty(candidate.website) || nonEmpty(candidate.email);
}

// ¿El lead persistido tiene algún canal de contacto (directo, canonical o social/email
// descubierto en enrichment)?
export function leadHasContact(lead: Lead): boolean {
  if (nonEmpty(lead.phone) || nonEmpty(lead.website)) return true;
  if (
    canonicalHasValue(lead.canonical_fields, "phone") ||
    canonicalHasValue(lead.canonical_fields, "website") ||
    canonicalHasValue(lead.canonical_fields, "email")
  ) {
    return true;
  }
  const footprint = (lead.digital_footprint ?? {}) as Record<string, unknown>;
  const contactEmails = footprint["contact_emails"];
  if (Array.isArray(contactEmails) && contactEmails.some(nonEmpty)) return true;
  const social = footprint["social_search"];
  const tags = new Set(lead.tags ?? []);
  if (social && typeof social === "object") {
    for (const platform of ["facebook", "instagram"]) {
      // Una red marcada muerta no cuenta como canal de contacto accionable.
      const deadTag = platform === "facebook" ? "fb-dead" : "ig-dead";
      if (tags.has(deadTag)) continue;
      const entry = (social as Record<string, unknown>)[platform];
      if (entry && typeof entry === "object" && nonEmpty((entry as { url?: unknown }).url)) {
        return true;
      }
    }
  }
  return false;
}
