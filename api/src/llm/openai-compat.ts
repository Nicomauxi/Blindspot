import { estimateCostUsd } from "./pricing.js";
import { z } from "zod";
import type {
  LeadAssistantBrief,
  LeadAssistantRequest,
  LLMProvider,
  LLMRequest,
  OfferPackage,
} from "./types.js";
import {
  buildCommercialAssistantMessages,
  parseCommercialAssistant,
} from "./lead-assistant.js";

const openAiCompatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

function buildOfferMessages(req: LLMRequest): Array<{ role: string; content: string }> {
  const system =
    "Eres un asistente de ventas para Blindspot, empresa uruguaya de marketing digital. " +
    "Genera mensajes cortos, directos y personalizados para prospectar negocios locales.";

  const user = [
    `Genera un mensaje de ventas de máximo 3 frases para contactar a "${req.lead_name}", `,
    `negocio de "${req.niche ?? "general"}" en Uruguay.`,
    req.pitch_hook ? ` Punto clave: ${req.pitch_hook}.` : "",
    req.price_uyu != null ? ` Referencia de precio: UYU ${req.price_uyu}.` : "",
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

  private async generateCompletion(messages: Array<{ role: string; content: string }>, maxTokens: number) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible API error: ${response.status}`);
    }

    const raw = await response.json();
    const parsed = openAiCompatResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`OpenAI-compatible API returned unexpected payload: ${parsed.error.message}`);
    }
    const data = parsed.data;

    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    const cost = estimateCostUsd(this.model, tokensIn, tokensOut);

    return { text, tokensIn, tokensOut, cost };
  }

  async generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const result = await this.generateCompletion(buildOfferMessages(req), 200);

    return {
      text: result.text,
      source_llm: this.name,
      generated_at: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_estimated: result.cost,
    };
  }

  async generateLeadBrief(req: LeadAssistantRequest): Promise<LeadAssistantBrief> {
    const result = await this.generateCompletion(buildCommercialAssistantMessages(req), 420);
    return {
      ...parseCommercialAssistant(result.text, this.name),
      model: this.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_estimated: result.cost,
    };
  }
}
