// P1 — Parser de la descripción/bio de una red social (FB "Acerca de" / IG bio).
//
// Esta información (horarios, teléfonos, dirección, oferta) es valiosa y hoy se descarta
// tras extraer sólo las métricas. Estrategia HÍBRIDA:
//   1. Regex/determinístico ($0, sin alucinación) para teléfonos, emails, website y un
//      heurístico de horarios.
//   2. LLM (Gemini Flash) SÓLO como fallback para texto libre (horarios/oferta) cuando el
//      regex no resolvió, con AbortController para no colgar el pipeline. Degrada a regex
//      ante cualquier fallo o si no hay credenciales.
import { z } from "zod";
import { classifyUruguayPhone } from "../../shared/phone.js";
import { normalizeEmail, businessDomain } from "../discovery/contact-match.js";

export type ParseMethod = "regex" | "llm" | "none";

export interface ParsedSocialDescription {
  raw_text: string | null;
  phones: string[]; // normalizados +598XXXXXXXX
  emails: string[];
  website: string | null;
  hours: string | null;
  offer: string | null;
  method: ParseMethod;
  field_confidence: Record<string, number>;
}

export interface ParseSocialDescriptionOpts {
  allowLlm?: boolean;
  // Timeout del fallback LLM (ms). Acotado para no bloquear el slot de concurrencia.
  llmTimeoutMs?: number;
}

const LLM_TIMEOUT_MS = 3000;

function emptyResult(raw: string | null): ParsedSocialDescription {
  return {
    raw_text: raw,
    phones: [],
    emails: [],
    website: null,
    hours: null,
    offer: null,
    method: "none",
    field_confidence: {},
  };
}

// ─── Regex extractors ────────────────────────────────────────────────────────

// Patrones de FECHA que el extractor de teléfonos debe rechazar (YYYY-MM-DD, DD/MM/YYYY).
// Sin esto, "2024-01-01" → "20240101" se clasificaría como fijo de Montevideo (+598...).
const DATE_LIKE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/;

function extractPhones(text: string): string[] {
  const out = new Set<string>();
  // Secuencias telefónicas: empiezan con + o dígito y contienen dígitos/espacios/sep.
  const candidates = text.match(/[+\d][\d\s().\-]{6,}\d/g) ?? [];
  for (const candidate of candidates) {
    if (DATE_LIKE.test(candidate)) continue; // descarta fechas (no son teléfonos)
    // Un mismo bloque puede traer varios teléfonos ("X y Y", "X / Y").
    const parts = candidate.split(/\s+y\s+|[,/;]/);
    for (const part of [...parts, candidate]) {
      if (DATE_LIKE.test(part)) continue;
      const classified = classifyUruguayPhone(part);
      // Sólo aceptar teléfonos UY reconocibles (móvil/fijo); descartar "unknown"
      // (IDs, años, conteos sueltos) para no contaminar canonical_fields.
      if (classified.normalized && classified.type !== "unknown") out.add(classified.normalized);
    }
  }
  return [...out];
}

function extractEmails(text: string): string[] {
  const out = new Set<string>();
  const matches = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) ?? [];
  for (const match of matches) {
    const normalized = normalizeEmail(match);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function extractWebsite(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s)]+|www\.[^\s)]+/gi) ?? [];
  for (const match of matches) {
    const url = match.startsWith("http") ? match : `https://${match}`;
    // businessDomain devuelve null para plataformas (instagram/facebook/linktr.ee…).
    if (businessDomain(url)) return url.replace(/[.,;]+$/, "");
  }
  return null;
}

// Heurístico de horarios: líneas con patrón de rango horario o keywords.
const HOURS_KEYWORDS = /\b(abierto|horario|lun|mar|mi[eé]|jue|vie|s[aá]b|dom|de\s+\w+\s+a\s+\w+)\b/i;
const HOURS_RANGE = /\d{1,2}\s*(?::\d{2})?\s*(?:a|-|–|hs?|h)\s*\d{1,2}/i;

function extractHours(text: string): string | null {
  const lines = text
    .split(/\r?\n|(?<=\.)\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const matched = lines.filter((l) => HOURS_RANGE.test(l) || HOURS_KEYWORDS.test(l));
  if (matched.length === 0) return null;
  return matched.join(" · ").slice(0, 240);
}

// ─── LLM fallback (Gemini Flash, time-boxed) ───────────────────────────────────

const LLM_OUTPUT_SCHEMA = z.object({
  hours: z.string().trim().min(1).max(240).nullable().optional(),
  offer: z.string().trim().min(1).max(240).nullable().optional(),
});

async function llmExtract(
  raw: string,
  timeoutMs: number
): Promise<{ hours: string | null; offer: string | null } | null> {
  const provider = process.env["LLM_PROVIDER"];
  if (provider !== "gemini") return null; // sólo Gemini soportado en este fallback
  const apiKey = process.env["GEMINI_API_KEY"] ?? "";
  if (!apiKey) return null;
  const model = process.env["LLM_MODEL"] ?? "gemini-2.0-flash";

  const prompt =
    `Extraé de esta bio/descripción de un negocio uruguayo el horario de atención y una ` +
    `frase corta de su oferta/servicios. Respondé SÓLO JSON: {"hours": string|null, "offer": string|null}. ` +
    `Sin texto extra. Descripción: """${raw.slice(0, 1200)}"""`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120, temperature: 0, responseMimeType: "application/json" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) return null;
    const parsed = LLM_OUTPUT_SCHEMA.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return { hours: parsed.data.hours ?? null, offer: parsed.data.offer ?? null };
  } catch {
    // AbortError, red, JSON inválido → degradar a regex (best-effort).
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────────

export async function parseSocialDescription(
  raw: string | null | undefined,
  _platform: "instagram" | "facebook",
  opts: ParseSocialDescriptionOpts = {}
): Promise<ParsedSocialDescription> {
  const text = (raw ?? "").trim();
  if (text.length === 0) return emptyResult(raw ?? null);

  const phones = extractPhones(text);
  const emails = extractEmails(text);
  const website = extractWebsite(text);
  const hoursRegex = extractHours(text);

  const fieldConfidence: Record<string, number> = {};
  if (phones.length) fieldConfidence["phones"] = 0.9;
  if (emails.length) fieldConfidence["emails"] = 0.9;
  if (website) fieldConfidence["website"] = 0.8;
  if (hoursRegex) fieldConfidence["hours"] = 0.5;

  let hours = hoursRegex;
  let offer: string | null = null;
  let method: ParseMethod = phones.length || emails.length || website || hoursRegex ? "regex" : "none";

  // Fallback LLM acotado: sólo si el regex NO resolvió horarios y hay texto suficiente.
  // Evita pagar una llamada de red por cada lead cuando el regex ya cubrió lo principal
  // (perf: salta el LLM en la mayoría de bios bien estructuradas).
  const allowLlm = opts.allowLlm ?? true;
  const needsLlm = !hoursRegex && text.length >= 40;
  if (allowLlm && needsLlm) {
    const llm = await llmExtract(text, opts.llmTimeoutMs ?? LLM_TIMEOUT_MS);
    if (llm) {
      if (!hours && llm.hours) {
        hours = llm.hours;
        fieldConfidence["hours"] = 0.7;
      }
      if (llm.offer) {
        offer = llm.offer;
        fieldConfidence["offer"] = 0.7;
      }
      method = "llm";
    }
  }

  return {
    raw_text: text,
    phones,
    emails,
    website,
    hours,
    offer,
    method,
    field_confidence: fieldConfidence,
  };
}
