// F6.4 — Constante única de costo Google Places (USD por request, SKU 2026).
// Antes duplicada en google-places-discovery-job.ts, cli/discover.ts y
// api discovery-insights.ts (ahí incluso como literal).
export const TEXT_SEARCH_COST_PER_REQUEST = 0.035;
export const DETAILS_COST_PER_REQUEST = 0.025;

/** Resultados por página del Text Search (paginación de la API). */
export const TEXT_SEARCH_PAGE_SIZE = 20;

export function estimateGooglePlacesCost(
  textSearchRequestCount: number,
  detailsRequestCount: number
): number {
  return (
    textSearchRequestCount * TEXT_SEARCH_COST_PER_REQUEST +
    detailsRequestCount * DETAILS_COST_PER_REQUEST
  );
}

/** Costo máximo proyectado para traer hasta maxResults leads (text search paginado + details). */
export function projectMaxGooglePlacesCost(maxResults: number): number {
  const safeMaxResults = Math.max(0, maxResults);
  return estimateGooglePlacesCost(Math.ceil(safeMaxResults / TEXT_SEARCH_PAGE_SIZE), safeMaxResults);
}

export interface GpBudgetGateResult {
  allowed: boolean;
  projected_usd: number;
}

/**
 * N74/N9.2 — Gate de presupuesto: un run de discovery solo arranca si su costo máximo
 * proyectado entra en el remaining. budget null (sin config) = permitido.
 */
export function gpBudgetGate(
  budget: { budget_remaining: number } | null,
  maxResults: number
): GpBudgetGateResult {
  const projected_usd = projectMaxGooglePlacesCost(maxResults);
  if (!budget) return { allowed: true, projected_usd };
  return { allowed: budget.budget_remaining > 0 && projected_usd <= budget.budget_remaining, projected_usd };
}
