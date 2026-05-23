import type { LeadAssistantBrief, LeadAssistantRequest } from "./types.js";

function asYesNo(value: boolean | null): string {
  if (value === true) return "si";
  if (value === false) return "no";
  return "n/a";
}

export function buildCommercialAssistantPrompt(req: LeadAssistantRequest): string {
  return [
    "Sos un estratega comercial de Blindspot enfocado en primeros contactos de venta para usuarios poco técnicos.",
    "Respondé en español rioplatense, concreto, útil para vender y sin inventar datos.",
    "Usá exactamente este formato:",
    "RESUMEN: ...",
    "IMPORTA: ...",
    "CANAL: ...",
    "PITCH: ...",
    "MENSAJE: ...",
    "OBJECIONES:",
    "- ...",
    "- ...",
    "RESPUESTAS:",
    "- ...",
    "- ...",
    "SIGUIENTE: ...",
    `Datos: nombre=${req.lead_name}, niche=${req.niche ?? "n/a"}, score=${req.prospect_score ?? "n/a"}, tier=${req.contact_tier ?? "n/a"}, urgencia=${req.urgency_signal ?? "n/a"}, oferta=${req.primary_offer ?? "n/a"}, pitch_hook=${req.pitch_hook ?? "n/a"}, estado=${req.state ?? "n/a"}, buyer=${req.top_buyer_type ?? "n/a"}, business_status=${req.business_status ?? "n/a"}, contacto_listo=${asYesNo(req.contact_ready)}, telefono=${req.phone ? "si" : "no"}, whatsapp=${req.whatsapp ? "si" : "no"}, email=${req.email ? "si" : "no"}, website=${req.website ? "si" : "no"}, confiabilidad_contacto=${req.contact_reliability_score ?? "n/a"}, confianza_fuente=${req.source_confidence ?? "n/a"}.`,
    "Elegí el canal recomendado según disponibilidad y confiabilidad de contacto.",
    "El mensaje debe ser breve, natural y listo para copiar.",
    "Las objeciones y respuestas deben ser plausibles para ese tipo de negocio, siempre apoyadas en los datos visibles.",
  ].join(" ");
}

export function buildCommercialAssistantMessages(req: LeadAssistantRequest): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "Eres un estratega comercial de Blindspot. Respondes en español, con foco en primeros contactos de venta, sin sonar robótico y sin inventar datos.",
    },
    {
      role: "user",
      content: buildCommercialAssistantPrompt(req),
    },
  ];
}

function extractSection(lines: string[], label: string): string | null {
  const prefix = `${label}:`;
  const line = lines.find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function extractList(lines: string[], label: string): string[] {
  const index = lines.findIndex((entry) => entry === `${label}:` || entry.startsWith(`${label}:`));
  if (index === -1) return [];
  const inlineLine = lines[index];
  if (!inlineLine) return [];
  const inline = inlineLine.slice(`${label}:`.length).trim();
  const items: string[] = [];
  if (inline) items.push(inline);
  for (const line of lines.slice(index + 1)) {
    if (/^[A-ZÁÉÍÓÚÜÑ]+:/u.test(line)) break;
    if (line.startsWith("- ")) items.push(line.slice(2).trim());
  }
  return items.filter(Boolean);
}

export function parseCommercialAssistant(text: string, provider: string): LeadAssistantBrief {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const summary = extractSection(lines, "RESUMEN") ?? text.trim() ?? "Sin resumen.";
  const whyItMatters = extractSection(lines, "IMPORTA") ?? "Sin explicación adicional.";
  const recommendedChannel = extractSection(lines, "CANAL") ?? "whatsapp";
  const personalizedPitch = extractSection(lines, "PITCH") ?? whyItMatters;
  const firstMessage = extractSection(lines, "MENSAJE") ?? summary;
  const likelyObjections = extractList(lines, "OBJECIONES");
  const objectionHandling = extractList(lines, "RESPUESTAS");
  const nextStep = extractSection(lines, "SIGUIENTE") ?? "Revisar el lead antes de actuar.";

  return {
    summary,
    why_it_matters: whyItMatters,
    next_step: nextStep,
    recommended_channel: recommendedChannel,
    personalized_pitch: personalizedPitch,
    first_message: firstMessage,
    likely_objections: likelyObjections.length > 0 ? likelyObjections : ["Validar contacto y timing antes de insistir."],
    objection_handling: objectionHandling.length > 0 ? objectionHandling : ["Abrí con una propuesta concreta y una siguiente acción simple."],
    source_llm: provider,
    generated_at: new Date().toISOString(),
    provider,
  };
}
