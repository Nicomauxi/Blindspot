// Fusión de los datos parseados de la red social (descripción/bio) hacia los
// canonical_fields del lead, como una fuente más ponderada por actividad.
//
// La red social NO crea un lead nuevo: corrobora el lead existente. Los teléfonos/emails/
// website parseados entran a la fusión multi-fuente con `source_confidence` derivado de la
// actividad (cuenta abandonada → piso → pierde conflictos y se marca `stale`).
//
// NOTA: la dirección social NO se ingiere todavía (alto riesgo de contaminación desde texto
// libre); se hará en una iteración posterior con extracción de dirección dedicada.
import type { DiscoveryCandidate, DiscoverySource, Lead } from "../../shared/types.js";
import { mergeCanonicalFields } from "../../storage/canonical-field.js";
import { socialSourceConfidence } from "./social-source-confidence.js";
import type { SocialActivityProfile } from "./social-activity.js";
import type { ParsedSocialDescription } from "./description-parse.js";

const SOCIAL_SOURCE: Record<SocialActivityProfile["platform"], DiscoverySource> = {
  instagram: "social_instagram",
  facebook: "social_facebook",
};

export interface SocialCanonicalInput {
  profile: SocialActivityProfile;
  parsed: ParsedSocialDescription;
  recencyDays: number | null;
}

export function buildSocialCandidate(input: SocialCanonicalInput): DiscoveryCandidate {
  const { profile, parsed, recencyDays } = input;
  const confidence = socialSourceConfidence({
    activity_status: profile.activity_status,
    audience_tier: profile.audience_tier,
    recency_days: recencyDays,
  });
  return {
    source: SOCIAL_SOURCE[profile.platform],
    external_id: profile.url,
    source_confidence: confidence,
    name: "",
    address: null,
    phone: parsed.phones[0] ?? null,
    website: parsed.website,
    email: parsed.emails[0] ?? null,
    latitude: null,
    longitude: null,
    niche: null,
    raw: {},
  };
}

// Aplica secuencialmente cada fuente social al lead, devolviendo los canonical_fields
// resultantes (o null si no hubo nada que fusionar). Inmutable: no muta `lead`.
export function mergeSocialIntoCanonical(
  lead: Lead,
  inputs: SocialCanonicalInput[]
): Record<string, unknown> | null {
  let working: Lead = lead;
  let changed = false;
  for (const input of inputs) {
    const candidate = buildSocialCandidate(input);
    if (!candidate.phone && !candidate.website && !candidate.email) continue;
    const merged = mergeCanonicalFields(working, candidate);
    if (merged) {
      working = { ...working, canonical_fields: merged };
      changed = true;
    }
  }
  return changed ? (working.canonical_fields as Record<string, unknown> | null) : null;
}
