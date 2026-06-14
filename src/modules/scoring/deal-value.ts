import type { Lead } from "../../shared/types.js";
import { NICHE_AVG_TICKET_UYU, DEFAULT_AVG_TICKET_UYU } from "./buyer-types.js";

// Estimación de VALOR DE DEAL: un eje de priorización ORTOGONAL al prospect_score. El score
// dice "qué tan buen prospecto es"; el deal-value dice "qué tan grande es el negocio" (= cuánto
// vale cerrarlo). Un vendedor con tiempo limitado quiere llamar al pez gordo primero.
//
// Proxy de tamaño: review_count (volumen de clientes) × ticket promedio del nicho → ingreso
// mensual estimado. Mismo proxy que computeCommissionEstimate (review_count × 2 órdenes/review).
// NO toca el scoring; se expone como columna derivada para ordenar/filtrar.

const ORDERS_PER_REVIEW = 2; // mismo factor que computeCommissionEstimate (buyer-types.ts)

// Umbrales sobre ingreso mensual estimado (UYU). Calibrados a la distribución de reviews UY:
// high ≈ 330+ reviews, medium ≈ 85+ reviews.
const HIGH_REVENUE_UYU = 200_000;
const MEDIUM_REVENUE_UYU = 50_000;

export type DealValueTier = "high" | "medium" | "low" | "unknown";

export interface DealValueEstimate {
  monthly_revenue_est_uyu: number | null;
  avg_ticket_uyu: number;
  tier: DealValueTier;
}

export function estimateDealValue(lead: Pick<Lead, "review_count" | "niche">): DealValueEstimate {
  const niche = lead.niche ?? "other";
  const avg_ticket_uyu = NICHE_AVG_TICKET_UYU[niche] ?? DEFAULT_AVG_TICKET_UYU;
  const reviews = lead.review_count;
  if (reviews == null || reviews <= 0) {
    return { monthly_revenue_est_uyu: null, avg_ticket_uyu, tier: "unknown" };
  }
  const monthly_revenue_est_uyu = Math.round(reviews * ORDERS_PER_REVIEW * avg_ticket_uyu);
  const tier: DealValueTier =
    monthly_revenue_est_uyu >= HIGH_REVENUE_UYU ? "high"
    : monthly_revenue_est_uyu >= MEDIUM_REVENUE_UYU ? "medium"
    : "low";
  return { monthly_revenue_est_uyu, avg_ticket_uyu, tier };
}
