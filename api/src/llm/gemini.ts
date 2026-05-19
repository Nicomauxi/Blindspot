import type { LLMProvider, LLMRequest, OfferPackage } from "./types.js";

const GEMINI_COST_PER_1K_IN = 0.000125;
const GEMINI_COST_PER_1K_OUT = 0.000375;

function buildPrompt(req: LLMRequest): string {
  return [
    `Genera un mensaje de ventas corto (máximo 3 frases) para contactar a ${req.lead_name}, `,
    `un negocio de tipo "${req.niche ?? "general"}" en Uruguay.`,
    req.pitch_hook ? ` Contexto clave: ${req.pitch_hook}.` : "",
    req.price_uyu != null ? ` Referencia de precio: UYU ${req.price_uyu}.` : "",
    ` Oferta: ${req.offer_type}. Canal: ${req.channel}.`,
    ` Responde solo con el texto del mensaje, sin introducciones ni explicaciones.`,
  ].join("");
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const prompt = buildPrompt(req);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;
    const cost =
      (tokensIn / 1000) * GEMINI_COST_PER_1K_IN +
      (tokensOut / 1000) * GEMINI_COST_PER_1K_OUT;

    return {
      text,
      source_llm: this.name,
      generated_at: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd_estimated: cost,
    };
  }
}
