import type {
  LeadAssistantBrief,
  LeadAssistantRequest,
  LLMProvider,
  LLMRequest,
  OfferPackage,
} from "./types.js";

const CHANNEL_GREETING: Record<string, string> = {
  whatsapp: "Hola",
  email: "Hola",
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

function recommendChannel(req: LeadAssistantRequest): string {
  if (req.whatsapp) return "whatsapp";
  if (req.email) return "email";
  if (req.phone) return "phone";
  return "contacto_directo";
}

function buildPitch(req: LeadAssistantRequest): string {
  const offer = req.primary_offer ?? "una mejora comercial concreta";
  const hook = req.pitch_hook ? `Entrar por ${req.pitch_hook.toLowerCase()}` : "Entrar por una mejora rápida y medible";
  const buyer = req.top_buyer_type ? ` para ${req.top_buyer_type}` : "";
  return `${hook} y proponer ${offer}${buyer} sin irse a una explicación técnica larga.`;
}

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

  generateLeadBrief(req: LeadAssistantRequest): Promise<LeadAssistantBrief> {
    const recommendedChannel = recommendChannel(req);
    const summary = [
      `${req.lead_name} aparece como lead ${req.niche ? `del nicho ${req.niche}` : "sin nicho claro"}`,
      req.prospect_score != null ? `con score ${req.prospect_score}/100` : "sin score visible",
      req.contact_tier ? `y tier ${req.contact_tier}` : "y sin tier asignado",
    ].join(" ");

    const whyItMatters = [
      req.pitch_hook ? `Gancho principal: ${req.pitch_hook}.` : "No hay pitch hook cargado todavía.",
      req.urgency_signal ? `Urgencia detectada: ${req.urgency_signal}.` : "No se detectó urgencia específica.",
      req.contact_ready ? "El contacto parece listo para accionar." : "Conviene revisar contacto antes de salir a prospectar.",
    ].join(" ");

    const personalizedPitch = buildPitch(req);
    const firstMessage = [
      CHANNEL_GREETING[recommendedChannel] ?? "Hola",
      `${req.lead_name}, vi que ${req.pitch_hook?.toLowerCase() ?? "hay una oportunidad comercial para mejorar tu captación"}.`,
      `Te escribo porque creo que ${req.primary_offer ?? "una mejora digital concreta"} puede ayudarte sin complicarte la operación.`,
      "Si te sirve, te muestro una idea puntual en un mensaje corto.",
    ].join(" ");

    const nextStep = req.contact_ready
      ? `Abrir outreach por ${recommendedChannel} con una propuesta de ${req.primary_offer ?? "contacto directo"} y registrar el resultado.`
      : "Completar o validar el contacto antes de iniciar outreach.";

    return Promise.resolve({
      summary,
      why_it_matters: whyItMatters,
      next_step: nextStep,
      recommended_channel: recommendedChannel,
      personalized_pitch: personalizedPitch,
      first_message: firstMessage,
      likely_objections: [
        "No tengo tiempo para ver esto ahora.",
        "Ya resolvemos esto de otra manera.",
      ],
      objection_handling: [
        "Abrí con un beneficio rápido y una siguiente acción mínima, no con una explicación larga.",
        "Mostrá cómo la propuesta complementa lo que ya hacen en vez de pedir un cambio total.",
      ],
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
