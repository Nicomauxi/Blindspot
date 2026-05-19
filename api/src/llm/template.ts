import type { LLMProvider, LLMRequest, OfferPackage } from "./types.js";

const CHANNEL_GREETING: Record<string, string> = {
  whatsapp: "Hola",
  email: "Estimado/a",
  phone: "Buen día",
};

const OFFER_DESCRIPTIONS: Record<string, string> = {
  web_nuevo: "un sitio web profesional",
  rediseno: "un rediseño de tu sitio web",
  marketing: "una solución de marketing digital",
  catalogo: "un catálogo digital online",
  software_pos: "un sistema de punto de venta",
  reservas: "un sistema de reservas online",
  delivery_system: "un sistema de delivery propio",
  contacto_directo: "una consultoría personalizada",
};

export class TemplateProvider implements LLMProvider {
  readonly name = "template";
  readonly model = "template-v1";

  generateOffer(req: LLMRequest): Promise<OfferPackage> {
    const greeting = CHANNEL_GREETING[req.channel] ?? "Hola";
    const offerDesc =
      OFFER_DESCRIPTIONS[req.offer_type] ??
      OFFER_DESCRIPTIONS[req.primary_offer ?? ""] ??
      "una solución digital";

    const hook = req.pitch_hook ? ` Notamos que ${req.pitch_hook.toLowerCase()}.` : "";
    const price = req.price_uyu != null ? ` Inversión desde UYU ${req.price_uyu.toLocaleString("es-UY")}.` : "";

    const text =
      `${greeting}, somos Blindspot.${hook} ` +
      `Ayudamos a negocios como ${req.lead_name ?? "el tuyo"} con ${offerDesc}.${price} ` +
      `¿Te parece si conversamos esta semana?`;

    return Promise.resolve({
      text,
      source_llm: "template",
      generated_at: new Date().toISOString(),
      provider: this.name,
      model: this.model,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd_estimated: 0,
    });
  }
}
