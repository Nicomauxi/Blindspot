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

export interface LeadAssistantBrief {
  summary: string;
  why_it_matters: string;
  next_step: string;
  recommended_channel: string;
  personalized_pitch: string;
  first_message: string;
  likely_objections: string[];
  objection_handling: string[];
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

export interface LeadAssistantRequest {
  lead_id: string;
  lead_name: string;
  niche: string | null;
  contact_tier: string | null;
  prospect_score: number | null;
  urgency_signal: string | null;
  primary_offer: string | null;
  pitch_hook: string | null;
  state: string | null;
  contact_ready: boolean | null;
  top_buyer_type: string | null;
  business_status: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  contact_reliability_score: number | null;
  source_confidence: number | null;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateOffer(req: LLMRequest): Promise<OfferPackage>;
  generateLeadBrief(req: LeadAssistantRequest): Promise<LeadAssistantBrief>;
}

export interface LlmUsageLog {
  provider: string;
  model: string;
  operation: string;
  lead_id: string | null;
  user_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
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
