export interface OfferPackage {
  text: string;
  source_llm: string;
  generated_at: string;
  provider?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd_estimated?: number;
}

export interface LLMRequest {
  lead_id: string;
  lead_name: string;
  niche: string | null;
  primary_offer: string | null;
  pitch_hook: string | null;
  offer_type: string;
  channel: string;
  price_uyu?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateOffer(req: LLMRequest): Promise<OfferPackage>;
}

export interface LlmUsageLog {
  provider: string;
  model: string;
  operation: string;
  lead_id: string | null;
  user_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  success: boolean;
  error: string | null;
}

export interface LegacyLlmUsageLog {
  lead_id: string;
  feature: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd_estimated: number;
  status: "success" | "error" | "fallback";
  duration_ms: number;
}
