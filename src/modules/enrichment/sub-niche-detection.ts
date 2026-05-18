// Classifies leads with niche='other' into sub-niches.
// Two paths: keyword matching (fast, free) then LLM fallback if configured.
// Result is stored in lead_company_data.detected_sub_niche.

import type { Lead } from "../../shared/types.js";

export type SubNicheResult = {
  detected_sub_niche: string;
  sub_niche_source: "keyword" | "llm";
  sub_niche_detected_at: string;
};

// Ordered by specificity — first match wins.
const KEYWORD_RULES: Array<{ pattern: RegExp; sub_niche: string }> = [
  { pattern: /veterinar/i, sub_niche: "veterinaria" },
  { pattern: /farmaci/i, sub_niche: "farmacia" },
  { pattern: /óptic|optic/i, sub_niche: "optica" },
  { pattern: /contabl|contador|estudio contabl|asesoria contabl/i, sub_niche: "contabilidad" },
  { pattern: /\bspa\b|centro estétic|estetica/i, sub_niche: "spa_estetica" },
  { pattern: /ferretería|ferreteria|pinturería|pintureria/i, sub_niche: "ferreteria" },
  { pattern: /joyería|joyeria|relojería|relojeria/i, sub_niche: "joyeria" },
  { pattern: /librería|libreria|papelería|papeleria/i, sub_niche: "libreria" },
  { pattern: /taller mecánic|taller mecanic|mecánic/i, sub_niche: "taller_mecanico" },
  { pattern: /electricidad|eléctric|electric/i, sub_niche: "electricidad" },
  { pattern: /plomería|plomeria|fontanería|fontaneria/i, sub_niche: "plomeria" },
  { pattern: /arquitectur|ingenier/i, sub_niche: "arquitectura_ingenieria" },
  { pattern: /abogad|derecho|juridico|notaría|notaria/i, sub_niche: "servicios_legales" },
  { pattern: /seguros|aseguradora/i, sub_niche: "seguros" },
  { pattern: /médic|medic|clínica|clinica|salud/i, sub_niche: "salud" },
  { pattern: /dentist|odontolog/i, sub_niche: "odontologia" },
  { pattern: /psicolog/i, sub_niche: "psicologia" },
  { pattern: /floreríá|floreria|florist/i, sub_niche: "floreria" },
  { pattern: /fotografía|fotografia|fotógrafo|fotografo/i, sub_niche: "fotografia" },
  { pattern: /mudanza|transporte/i, sub_niche: "transporte" },
  { pattern: /construcción|construccion|albañil|albanil/i, sub_niche: "construccion" },
  { pattern: /limpieza|cleaning/i, sub_niche: "limpieza" },
  { pattern: /escuela|academia|institución educativ|instituto/i, sub_niche: "educacion" },
  { pattern: /iglesia|templo|parroquia/i, sub_niche: "religion" },
  { pattern: /inmobiliaria|propiedad|bienes raíces|bienes raices/i, sub_niche: "inmobiliaria" },
  { pattern: /ropa|vestimenta|indumentaria|boutique/i, sub_niche: "moda" },
  { pattern: /supermercado|almacén|almacen|minimarket/i, sub_niche: "almacen" },
];

function keywordDetect(name: string, address: string): string | null {
  const text = `${name} ${address}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) return rule.sub_niche;
  }
  return null;
}

async function llmDetect(name: string, address: string): Promise<string | null> {
  const provider = process.env["LLM_PROVIDER"];
  if (!provider) return null;

  const prompt =
    `Classify this Uruguayan business into ONE sub-niche category (single word or snake_case). ` +
    `Business name: "${name}". Address: "${address}". ` +
    `Reply with ONLY the sub-niche word, nothing else. Examples: veterinaria, farmacia, optica, ferreteria, contabilidad.`;

  try {
    if (provider === "gemini") {
      const apiKey = process.env["GEMINI_API_KEY"] ?? "";
      const model = process.env["LLM_MODEL"] ?? "gemini-2.0-flash";
      if (!apiKey) return null;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 20, temperature: 0 },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      return text.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || null;
    }

    if (provider === "ollama") {
      const baseUrl = (process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434").replace(/\/$/, "");
      const model = process.env["LLM_MODEL"] ?? "llama3.2";
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: 10, temperature: 0 } }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      const text = (data.response ?? "").trim();
      return text.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || null;
    }
  } catch {
    // Best-effort — no LLM is not a fatal error
  }

  return null;
}

export async function detectSubNiche(lead: Lead): Promise<SubNicheResult | null> {
  if (lead.niche !== "other") return null;

  const existing = (lead.lead_company_data as Record<string, unknown> | null)?.["detected_sub_niche"];
  if (existing) return null;

  const name = lead.name ?? "";
  const address = lead.address ?? "";

  const keyword = keywordDetect(name, address);
  if (keyword) {
    return {
      detected_sub_niche: keyword,
      sub_niche_source: "keyword",
      sub_niche_detected_at: new Date().toISOString(),
    };
  }

  const llmResult = await llmDetect(name, address);
  if (llmResult) {
    return {
      detected_sub_niche: llmResult,
      sub_niche_source: "llm",
      sub_niche_detected_at: new Date().toISOString(),
    };
  }

  return null;
}
