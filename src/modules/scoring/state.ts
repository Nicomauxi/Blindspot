import type { InferredState, Lead } from "../../shared/types.js";

type InferredBoolField = keyof Omit<InferredState, "digitalization_level" | "computed_at">;

export function getLeadInferredState(lead: Lead): InferredState | null {
  return lead.inferred_state ?? null;
}

export function inferredBool(state: InferredState | null, field: InferredBoolField): boolean {
  return state?.[field]?.value === true;
}

// N09: tri-estado para matching de pitch hooks — `false` solo cuando la AUSENCIA está
// verificada (campo presente con confidence > 0). Un campo ausente/confidence 0 es
// 'unknown' y no debe matchear overrides con when.X === false (el hook afirmaría
// hechos sobre un negocio del que no sabemos nada).
export function inferredTriState(
  state: InferredState | null,
  field: InferredBoolField
): boolean | "unknown" {
  const entry = state?.[field];
  if (!entry || typeof entry.value !== "boolean") return "unknown";
  if (entry.value === true) return true;
  return (entry.confidence ?? 0) > 0 ? false : "unknown";
}
