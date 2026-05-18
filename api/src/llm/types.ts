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
