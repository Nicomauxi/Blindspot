import type { LLMProvider, LLMRequest, OfferPackage } from "./types.js";

const DEFAULT_COST_PER_1K_IN = 0.0005;
const DEFAULT_COST_PER_1K_OUT = 0.0015;

function buildMessages(req: LLMRequest): Array<{ role: string; content: string }> {
  const system =
    "Eres un asistente de ventas para Blindspot, empresa uruguaya de marketing digital. " +
    "Genera mensajes cortos, directos y personalizados para prospectar negocios locales.";

  const user = [
    `Genera un mensaje de ventas de máximo 3 frases para contactar a "${req.lead_name}", `,
    `negocio de "${req.niche ?? "general"}" en Uruguay.`,
    req.pitch_hook ? ` Punto clave: ${req.pitch_hook}.` : "",
    ` Oferta: ${req.offer_type}. Canal: ${req.channel}. Solo el mensaje, sin encabezados.`,
  ].join("");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: buildMessages(req),
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    const cost =
      (tokensIn / 1000) * DEFAULT_COST_PER_1K_IN +
      (tokensOut / 1000) * DEFAULT_COST_PER_1K_OUT;

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
