import type { DiscoveryCandidate, DiscoverySource, Lead } from "../../shared/types.js";

// Fuentes que solo aportan valor como SEÑAL al corroborar otro lead (no como lead
// standalone). pedidosya no expone contacto: su valor es la señal "tiene delivery".
export const SIGNAL_ONLY_SOURCES = new Set<DiscoverySource>(["pedidosya"]);

export interface QualificationInput {
  source: DiscoverySource;
  hasContact: boolean;
  corroborated: boolean;
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
  // Un lead corroborado por otra fuente es un negocio real confirmado → siempre pasa.
  if (input.corroborated) {
    return { passed_filter: true, rejection_reasons: [] };
  }

  const rejection_reasons: string[] = [];
  if (SIGNAL_ONLY_SOURCES.has(input.source)) {
    rejection_reasons.push("signal-source-only");
  }
  if (!input.hasContact) {
    rejection_reasons.push("no-contact");
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
  if (social && typeof social === "object") {
    for (const platform of ["facebook", "instagram"]) {
      const entry = (social as Record<string, unknown>)[platform];
      if (entry && typeof entry === "object" && nonEmpty((entry as { url?: unknown }).url)) {
        return true;
      }
    }
  }
  return false;
}
