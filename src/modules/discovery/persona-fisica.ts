// Ley 18.331 — minimización de datos de personas físicas. Cuando un lead se marca como persona
// física se oculta (passed_filter=false) y se le BORRAN los datos personales, conservando solo lo
// mínimo para reconocerlo en una re-ingesta y NO reprocesarlo (place_id/external_id/source/name
// público de directorio + el flag is_natural_person). `name` es NOT NULL y proviene del listado
// público de la fuente → se conserva como identificador mínimo.

export const PERSONA_FISICA_REJECTION = "persona-fisica";

// Campos personales/derivados que se anulan al minimizar (contacto + enrichment + crudo del provider).
// Nota: `email` NO es columna de leads (vive en canonical_fields, que se anula abajo).
const PII_FIELDS = [
  "phone",
  "whatsapp",
  "address",
  "website",
  "gps",
  "source_data",
  "digital_footprint",
  "canonical_fields",
  "inferred_state",
  "score_breakdown",
  "systems_gap_breakdown",
  "notes",
  "contact_reliability_score",
  "data_confidence_score",
] as const;

/** ¿Las razones de rechazo marcan al lead como persona física? */
export function isPersonaFisicaRejection(reasons: readonly string[] | null | undefined): boolean {
  return (reasons ?? []).includes(PERSONA_FISICA_REJECTION);
}

/**
 * Parche de minimización: campos personales en null + is_natural_person=true. Se mezcla sobre
 * el objeto de upsert/update para no persistir (o borrar) datos personales del individuo.
 */
export function personaFisicaRedaction(): Record<string, null | boolean> {
  const patch: Record<string, null | boolean> = { is_natural_person: true };
  for (const field of PII_FIELDS) patch[field] = null;
  return patch;
}
