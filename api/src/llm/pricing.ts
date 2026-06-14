// F6.1 — Tarifas LLM por modelo (USD por 1K tokens), antes hardcodeadas planas en cada
// provider. Override por env: LLM_COST_PER_1K_IN / LLM_COST_PER_1K_OUT (para modelos
// nuevos sin redeploy). Tarifas de referencia 2026 (Google AI Studio / OpenAI).

export interface ModelPricing {
  costPer1kIn: number;
  costPer1kOut: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": { costPer1kIn: 0.000125, costPer1kOut: 0.000375 },
  "gemini-2.5-flash-lite": { costPer1kIn: 0.0000625, costPer1kOut: 0.0001875 },
  "gemini-2.5-pro": { costPer1kIn: 0.00125, costPer1kOut: 0.005 },
  "gpt-4o-mini": { costPer1kIn: 0.00015, costPer1kOut: 0.0006 },
  "gpt-4o": { costPer1kIn: 0.0025, costPer1kOut: 0.01 },
};

// Fallback conservador para modelos no listados (orden de gpt-4o-mini).
const FALLBACK_PRICING: ModelPricing = { costPer1kIn: 0.0005, costPer1kOut: 0.0015 };

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function resolveModelPricing(model: string): ModelPricing {
  const base = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  return {
    costPer1kIn: envNumber("LLM_COST_PER_1K_IN") ?? base.costPer1kIn,
    costPer1kOut: envNumber("LLM_COST_PER_1K_OUT") ?? base.costPer1kOut,
  };
}

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const { costPer1kIn, costPer1kOut } = resolveModelPricing(model);
  return (tokensIn / 1000) * costPer1kIn + (tokensOut / 1000) * costPer1kOut;
}
