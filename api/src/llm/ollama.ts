import type {
  LeadAssistantBrief,
  LeadAssistantRequest,
  LLMProvider,
  LLMRequest,
  OfferPackage,
} from "./types.js";
import {
  buildCommercialAssistantPrompt,
  parseCommercialAssistant,
} from "./lead-assistant.js";

function buildOfferPrompt(req: LLMRequest): string {
  return [
    `Genera un mensaje de ventas corto (máximo 3 frases) para contactar a ${req.lead_name}, `,
    `un negocio de tipo "${req.niche ?? "general"}" en Uruguay.`,
    req.pitch_hook ? ` Contexto: ${req.pitch_hook}.` : "",
    req.price_uyu != null ? ` Referencia de precio: UYU ${req.price_uyu}.` : "",
    ` Oferta: ${req.offer_type}. Canal: ${req.channel}.`,
    " Solo devuelve el texto del mensaje.",
  ].join("");
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  private async generateText(prompt: string, numPredict: number) {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { num_predict: numPredict, temperature: 0.7 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: (data.response ?? "").trim(),
      tokensIn: data.prompt_eval_count ?? 0,
      tokensOut: data.eval_count ?? 0,
    };
  }

  async generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const result = await this.generateText(buildOfferPrompt(req), 200);

    return {
      text: result.text,
      source_llm: this.name,
      generated_at: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_estimated: 0,
    };
  }

  async generateLeadBrief(req: LeadAssistantRequest): Promise<LeadAssistantBrief> {
    const result = await this.generateText(buildCommercialAssistantPrompt(req), 420);
    return {
      ...parseCommercialAssistant(result.text, this.name),
      model: this.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_estimated: 0,
    };
  }
}
