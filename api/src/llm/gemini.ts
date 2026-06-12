import { z } from "zod";
import { estimateCostUsd } from "./pricing.js";
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

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
});

function buildOfferPrompt(req: LLMRequest): string {
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

  private async generateText(prompt: string, maxOutputTokens: number) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // N80: sin timeout, un Gemini colgado bloqueaba la request del asistente.
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens, temperature: 0.7 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const raw = await response.json();
    const parsed = geminiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Gemini API returned unexpected payload: ${parsed.error.message}`);
    }
    const data = parsed.data;

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;
    const cost = estimateCostUsd(this.model, tokensIn, tokensOut);

    return { text, tokensIn, tokensOut, cost };
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
      cost_usd_estimated: result.cost,
    };
  }

  async generateLeadBrief(req: LeadAssistantRequest): Promise<LeadAssistantBrief> {
    const result = await this.generateText(buildCommercialAssistantPrompt(req), 420);
    return {
      ...parseCommercialAssistant(result.text, this.name),
      model: this.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_estimated: result.cost,
    };
  }
}
