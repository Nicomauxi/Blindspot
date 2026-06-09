// P2 — Confianza de la red social como FUENTE de datos, ponderada por su actividad.
//
// La fuente social no tiene un peso fijo: una cuenta activa y con audiencia es un dato
// probablemente fresco; una cuenta abandonada es potencialmente deprecated. Este score
// alimenta `candidate.source_confidence` en la fusión multi-fuente (canonical-field.ts),
// de modo que una cuenta abandonada nunca gane un conflicto contra Google Places.
import type { ActivityStatus, AudienceTier } from "./social-activity.js";

export interface SocialSourceSignals {
  activity_status: ActivityStatus;
  audience_tier: AudienceTier | null;
  recency_days?: number | null;
}

const BASE = 0.45;
// Techo y piso: la social nunca supera al ancla Google (~0.9) ni baja del piso que la
// deja siempre por debajo del umbral `stale` (0.2) cuando está abandonada.
const FLOOR = 0.2;
const CEILING = 0.85;
// Penalidad de cuenta abandonada: la lleva exactamente al piso (0.45 - 0.25 = 0.20).
const ABANDONED_PENALTY = 0.25;

const RECENCY_FRESH_DAYS = 30;
const RECENCY_RECENT_DAYS = 90;
const RECENCY_FRESH_BONUS = 0.25;
const RECENCY_RECENT_BONUS = 0.1;
const ACTIVE_NO_RECENCY_BONUS = 0.1;

const AUDIENCE_BONUS: Record<AudienceTier, number> = { high: 0.1, medium: 0.05, low: 0 };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number): number {
  return Math.min(CEILING, Math.max(FLOOR, value));
}

function activityBonus(signals: SocialSourceSignals): number {
  if (signals.activity_status === "abandoned") return -ABANDONED_PENALTY;
  if (signals.activity_status !== "active") return 0; // unknown: sin bonus ni castigo

  const recency = signals.recency_days;
  if (recency == null) return ACTIVE_NO_RECENCY_BONUS;
  if (recency <= RECENCY_FRESH_DAYS) return RECENCY_FRESH_BONUS;
  if (recency <= RECENCY_RECENT_DAYS) return RECENCY_RECENT_BONUS;
  return 0; // activa pero sin captura reciente: no penaliza pero no premia frescura
}

export function socialSourceConfidence(signals: SocialSourceSignals): number {
  // Cuenta abandonada: deprecated → piso, sin importar la audiencia.
  if (signals.activity_status === "abandoned") {
    return round2(clamp(BASE - ABANDONED_PENALTY));
  }
  const audience = signals.audience_tier ? AUDIENCE_BONUS[signals.audience_tier] : 0;
  return round2(clamp(BASE + activityBonus(signals) + audience));
}
