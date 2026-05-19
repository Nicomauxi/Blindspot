import type { LLMProvider, LLMRequest, OfferPackage } from "./types.js";

function buildPrompt(req: LLMRequest): string {
  return [
    `Genera un mensaje de ventas corto (máximo 3 frases) para contactar a ${req.lead_name}, `,
    `un negocio de tipo "${req.niche ?? "general"}" en Uruguay.`,
    req.pitch_hook ? ` Contexto: ${req.pitch_hook}.` : "",
    req.price_uyu != null ? ` Referencia de precio: UYU ${req.price_uyu}.` : "",
    ` Oferta: ${req.offer_type}. Canal: ${req.channel}.`,
    ` Solo devuelve el texto del mensaje.`,
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

  async generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: buildPrompt(req),
        stream: false,
        options: { num_predict: 200, temperature: 0.7 },
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

    const text = (data.response ?? "").trim();
    const tokensIn = data.prompt_eval_count ?? 0;
    const tokensOut = data.eval_count ?? 0;

    return {
      text,
      source_llm: this.name,
      generated_at: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd_estimated: 0,
    };
  }
}
