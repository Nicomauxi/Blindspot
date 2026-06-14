// Fusión multi-fuente a nivel de campo (canonical_fields). Módulo único compartido
// por external-leads.ts (corroboración de fuentes externas) y reconciliation.ts (merge
// de leads), para que la lógica no diverja entre ambos caminos de escritura.
//
// Un campo canónico unifica el mismo dato visto en varias fuentes: se muestra una sola
// vez y la confianza sube con cada fuente que lo corrobora. Cuando dos fuentes discrepan
// se conserva el valor más confiable, se marca `conflict` y NO se pierde el valor perdedor
// (queda en `conflict_alternatives` para revisión).
import type { DiscoveryCandidate, Lead } from "../shared/types.js";
import { normalizeAddress } from "../modules/discovery/geo-text.js";

// Fuente ancla de máxima fiabilidad estructural (no usar el literal suelto).
export const GOOGLE_SOURCE = "google_places";

// Confianza por corroboración: cada fuente extra suma esto (hasta el techo).
const CORROBORATION_STEP = 0.15;
const CONFIDENCE_CEILING = 0.95;
// Un valor cuya fuente cae a este nivel o menos se considera potencialmente
// desactualizado (p. ej. cuenta social abandonada): se marca `stale` y nunca gana.
const STALE_CONFIDENCE_MAX = 0.2;

export type CanonicalFieldName = "phone" | "website" | "email" | "address";
export type CanonicalFieldMethod = "single" | "corroboration" | "source_confidence" | "google_priority";

export interface CanonicalConflictAlternative {
  value: string;
  confidence: number;
  sources: string[];
  source: string;
}

export interface CanonicalFieldValue {
  value: string;
  confidence: number;
  sources: string[];
  conflict: boolean;
  // Campos opcionales: se OMITEN cuando no aplican para no alterar el shape histórico
  // `{value, confidence, sources, conflict}` que asume el resto del sistema.
  stale?: boolean;
  conflict_alternatives?: CanonicalConflictAlternative[];
  method?: CanonicalFieldMethod;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isConflictAlternative(value: unknown): value is CanonicalConflictAlternative {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

// Coerciona el JSON persistido a CanonicalFieldValue, preservando los campos
// opcionales sólo si venían presentes (no introduce keys nuevas).
export function canonicalFieldEntry(value: unknown): CanonicalFieldValue | null {
  if (typeof value === "string") {
    return { value, confidence: 0.5, sources: [], conflict: false };
  }

  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    const field = value as {
      value: string;
      confidence?: number;
      sources?: unknown[];
      conflict?: boolean;
      stale?: boolean;
      conflict_alternatives?: unknown;
      method?: unknown;
    };
    const sources = Array.isArray(field.sources)
      ? field.sources.filter((source): source is string => typeof source === "string")
      : [];

    const entry: CanonicalFieldValue = {
      value: field.value,
      confidence: typeof field.confidence === "number" ? field.confidence : 0.5,
      sources,
      conflict: field.conflict === true,
    };
    if (field.stale === true) entry.stale = true;
    if (Array.isArray(field.conflict_alternatives)) {
      const alts = field.conflict_alternatives.filter(isConflictAlternative);
      if (alts.length > 0) entry.conflict_alternatives = alts;
    }
    if (typeof field.method === "string") {
      entry.method = field.method as CanonicalFieldMethod;
    }
    return entry;
  }

  return null;
}

// Normaliza para comparar igualdad entre fuentes. address delega en geo-text para usar
// la MISMA normalización que dedup/reconciliación (no reimplementar).
export function normalizeComparableValue(field: CanonicalFieldName, value: string): string {
  const trimmed = value.trim();
  if (field === "phone") return trimmed.replace(/\D/g, "");

  if (field === "website") {
    try {
      const url = new URL(trimmed);
      url.hash = "";
      url.search = "";
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return trimmed.toLowerCase().replace(/\/+$/, "");
    }
  }

  if (field === "address") return normalizeAddress(trimmed) ?? trimmed.toLowerCase();

  return trimmed.toLowerCase();
}

function existingLeadValue(lead: Lead, field: CanonicalFieldName): string | null {
  if (field === "phone") return lead.phone;
  if (field === "website") return lead.website;
  if (field === "address") return lead.address;
  return null; // email no tiene columna directa: sólo vive en canonical/footprint
}

function isGoogleSourced(sources: string[], fallbackSource: string): boolean {
  return sources.includes(GOOGLE_SOURCE) || fallbackSource === GOOGLE_SOURCE;
}

function dedupeAlternatives(
  field: CanonicalFieldName,
  alts: CanonicalConflictAlternative[],
  excludeValue: string
): CanonicalConflictAlternative[] {
  // Dedupe por valor NORMALIZADO (no crudo): "099 123 456" y "099123456" son el mismo
  // teléfono; igual la dirección con/sin abreviaturas. Excluye el valor ganador actual.
  const excludeKey = normalizeComparableValue(field, excludeValue);
  const seen = new Set<string>();
  const out: CanonicalConflictAlternative[] = [];
  for (const alt of alts) {
    const key = normalizeComparableValue(field, alt.value);
    if (key === excludeKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alt);
  }
  return out;
}

export function buildCanonicalField(
  lead: Lead,
  field: CanonicalFieldName,
  candidate: DiscoveryCandidate,
  candidateValue: string | null
): CanonicalFieldValue | null {
  const existingField = canonicalFieldEntry(lead.canonical_fields?.[field]);
  const existingValue = existingField?.value ?? existingLeadValue(lead, field);

  if (!existingValue && !candidateValue) return null;

  // Sólo candidato (campo nuevo).
  if (!existingValue && candidateValue) {
    const confidence = round2(Math.min(CONFIDENCE_CEILING, candidate.source_confidence));
    const result: CanonicalFieldValue = {
      value: candidateValue,
      confidence,
      sources: [candidate.source],
      conflict: false,
    };
    if (confidence <= STALE_CONFIDENCE_MAX) result.stale = true;
    return result;
  }

  // Sólo existente (candidato no aporta este campo): se conserva tal cual.
  if (!candidateValue && existingField) return existingField;
  if (!candidateValue && existingValue) {
    return {
      value: existingValue,
      confidence: round2(Math.min(CONFIDENCE_CEILING, lead.source_confidence ?? 0.5)),
      sources: existingField?.sources.length ? existingField.sources : [lead.source],
      conflict: existingField?.conflict ?? false,
    };
  }

  const safeExistingValue = existingValue ?? "";
  const safeCandidateValue = candidateValue ?? "";
  const sameValue =
    normalizeComparableValue(field, safeExistingValue) ===
    normalizeComparableValue(field, safeCandidateValue);

  // Corroboración: misma información en otra fuente → un dato, mayor confianza.
  if (sameValue) {
    const sources = Array.from(
      new Set([
        ...(existingField?.sources.length ? existingField.sources : [lead.source]),
        candidate.source,
      ])
    );
    const result: CanonicalFieldValue = {
      value: safeExistingValue,
      confidence: round2(
        Math.min(CONFIDENCE_CEILING, (lead.source_confidence ?? 0.5) + (sources.length - 1) * CORROBORATION_STEP)
      ),
      sources,
      conflict: false,
    };
    // Preservar alternativas previas si las hubiera (no se pierden por corroborar).
    if (existingField?.conflict_alternatives?.length) {
      result.conflict_alternatives = existingField.conflict_alternatives;
      result.conflict = true;
    }
    return result;
  }

  // Conflicto: las fuentes discrepan. Resolución:
  //   1. Google Places es canónico frente a una fuente no-Google (más fiable).
  //   2. En otro caso gana mayor source_confidence (regla histórica).
  //   3. El valor perdedor NO se descarta: va a conflict_alternatives.
  const existingConfidence = existingField?.confidence ?? (lead.source_confidence ?? 0.5);
  const existingSources = existingField?.sources.length ? existingField.sources : [lead.source];
  const existingIsGoogle = isGoogleSourced(existingSources, lead.source);
  const candidateIsGoogle = candidate.source === GOOGLE_SOURCE;

  let useCandidate: boolean;
  let method: CanonicalFieldMethod;
  if (candidateIsGoogle && !existingIsGoogle) {
    useCandidate = true;
    method = "google_priority";
  } else if (existingIsGoogle && !candidateIsGoogle) {
    useCandidate = false;
    method = "google_priority";
  } else {
    useCandidate = candidate.source_confidence > existingConfidence;
    method = "source_confidence";
  }

  const winnerValue = useCandidate ? safeCandidateValue : safeExistingValue;
  const winnerConfidence = useCandidate ? candidate.source_confidence : existingConfidence;
  const winnerSources = useCandidate ? [candidate.source] : existingSources;
  const loserValue = useCandidate ? safeExistingValue : safeCandidateValue;
  const loserConfidence = useCandidate ? existingConfidence : candidate.source_confidence;
  const loserSources = useCandidate ? existingSources : [candidate.source];

  const priorAlternatives = existingField?.conflict_alternatives ?? [];
  const alternatives = dedupeAlternatives(
    field,
    [
      ...priorAlternatives,
      {
        value: loserValue,
        confidence: round2(loserConfidence),
        sources: Array.from(new Set(loserSources)),
        source: loserSources[0] ?? lead.source,
      },
    ],
    winnerValue
  );

  const result: CanonicalFieldValue = {
    value: winnerValue,
    confidence: round2(Math.min(CONFIDENCE_CEILING, Math.max(existingConfidence, candidate.source_confidence))),
    sources: Array.from(new Set(winnerSources)),
    conflict: true,
    method,
  };
  if (alternatives.length > 0) result.conflict_alternatives = alternatives;
  if (round2(winnerConfidence) <= STALE_CONFIDENCE_MAX) result.stale = true;
  return result;
}

export function mergeCanonicalFields(
  lead: Lead,
  candidate: DiscoveryCandidate
): Record<string, unknown> | null {
  const nextFields: Record<string, unknown> = {
    ...((lead.canonical_fields ?? {}) as Record<string, unknown>),
  };

  const phone = buildCanonicalField(lead, "phone", candidate, candidate.phone);
  const website = buildCanonicalField(lead, "website", candidate, candidate.website);
  const email = buildCanonicalField(lead, "email", candidate, candidate.email ?? null);
  const address = buildCanonicalField(lead, "address", candidate, candidate.address);

  if (phone) nextFields.phone = phone;
  if (website) nextFields.website = website;
  if (email) nextFields.email = email;
  if (address) nextFields.address = address;

  return Object.keys(nextFields).length > 0 ? nextFields : null;
}
