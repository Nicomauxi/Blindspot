import type { InferredState, Lead } from "../../shared/types.js";

type InferredBoolField = keyof Omit<InferredState, "digitalization_level" | "computed_at">;

export function getLeadInferredState(lead: Lead): InferredState | null {
  return lead.inferred_state ?? null;
}

export function inferredBool(state: InferredState | null, field: InferredBoolField): boolean {
  return state?.[field]?.value === true;
}
