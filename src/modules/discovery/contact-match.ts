import type { Lead } from "../../shared/types.js";
import { canonicalUruguayPhoneKey } from "../../shared/phone.js";

// Dominios de plataformas/agregadores: NO identifican un negocio puntual, así que no
// sirven como clave de unión (cientos de leads comparten instagram.com, etc.).
const PLATFORM_DOMAINS = new Set([
  "instagram.com",
  "m.instagram.com",
  "facebook.com",
  "m.facebook.com",
  "fb.com",
  "wa.me",
  "api.whatsapp.com",
  "linktr.ee",
  "sites.google.com",
  "google.com",
  "maps.google.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  // directorios fuente del propio sistema
  "yelu.uy",
  "pedidosya.com.uy",
  "catalogodatos.gub.uy",
]);

export function normalizePhone(value: string | null | undefined): string | null {
  // IT-01: única clave canónica (shared/phone) para que +598../09../bare colapsen.
  return canonicalUruguayPhoneKey(value);
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return /.+@.+\..+/.test(email) ? email : null;
}

// Devuelve el dominio "propio" del negocio, o null si es una plataforma/agregador.
export function businessDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  let host = website.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").replace(/^www\./, "");
  host = host.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  if (host.length === 0 || !host.includes(".")) return null;
  if (PLATFORM_DOMAINS.has(host)) return null;
  // normalizar subdominio m. y www. ya removido
  host = host.replace(/^m\./, "");
  if (PLATFORM_DOMAINS.has(host)) return null;
  return host;
}

function canonicalValue(canonicalFields: Lead["canonical_fields"], field: "phone" | "website" | "email"): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;
  const raw = (canonicalFields as Record<string, unknown>)[field];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof (raw as { value: unknown }).value === "string") {
    return (raw as { value: string }).value;
  }
  return null;
}

export interface ContactKeys {
  phones: string[];
  domains: string[];
  emails: string[];
}

// Extrae las claves de contacto normalizadas de un lead (directas + canonical).
export function contactKeys(lead: Lead): ContactKeys {
  const phones = new Set<string>();
  const domains = new Set<string>();
  const emails = new Set<string>();

  const phone = normalizePhone(lead.phone ?? canonicalValue(lead.canonical_fields, "phone"));
  if (phone) phones.add(phone);

  const domain = businessDomain(lead.website ?? canonicalValue(lead.canonical_fields, "website"));
  if (domain) domains.add(domain);

  const email = normalizeEmail(canonicalValue(lead.canonical_fields, "email"));
  if (email) emails.add(email);

  return { phones: [...phones], domains: [...domains], emails: [...emails] };
}

export type ContactKeyKind = "phone" | "domain" | "email";

export interface ContactKeyRef {
  kind: ContactKeyKind;
  key: string;
}

// Todas las claves de un lead como refs (para indexar).
export function contactKeyRefs(lead: Lead): ContactKeyRef[] {
  const keys = contactKeys(lead);
  return [
    ...keys.phones.map((key) => ({ kind: "phone" as const, key })),
    ...keys.domains.map((key) => ({ kind: "domain" as const, key })),
    ...keys.emails.map((key) => ({ kind: "email" as const, key })),
  ];
}
