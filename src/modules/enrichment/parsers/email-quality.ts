import { promises as dns } from "node:dns";
import type { EmailQualityAssessment, EmailQualityKind } from "../../../shared/types.js";

type ResolveMx = (hostname: string) => Promise<Array<{ exchange: string; priority: number }>>;

const GENERIC_LOCALS = new Set([
  "admin",
  "contact",
  "contacto",
  "hello",
  "hola",
  "info",
  "reservas",
  "sales",
  "soporte",
  "support",
  "ventas",
]);

const ROLE_LOCALS = new Set([
  "ceo",
  "direccion",
  "director",
  "duenio",
  "dueno",
  "dueño",
  "gerencia",
  "owner",
  "propietario",
]);

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

function normalizeSlug(value: string): string {
  return normalizeAscii(value).replace(/[^a-z0-9]+/g, "");
}

function localPartTokens(localPart: string): string[] {
  return normalizeAscii(localPart)
    .replace(/\+.*/, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function classifyLocalPart(localPart: string): EmailQualityKind {
  const tokens = localPartTokens(localPart);
  if (tokens.length === 0) return "unknown";
  if (tokens.some((token) => ROLE_LOCALS.has(token))) return "role";
  if (tokens.some((token) => GENERIC_LOCALS.has(token))) return "generic";

  const looksPersonal =
    tokens.length >= 2 &&
    tokens.every((token) => /^[a-z]{2,}$/.test(token));

  return looksPersonal ? "personal" : "unknown";
}

function domainMatchesBusiness(domain: string, businessName: string | null | undefined): boolean {
  if (!businessName) return false;
  const domainSlug = normalizeSlug(domain.split(".")[0] ?? "");
  const businessSlug = normalizeSlug(businessName);
  if (domainSlug.length < 4 || businessSlug.length < 4) return false;
  return businessSlug.includes(domainSlug) || domainSlug.includes(businessSlug);
}

function baseMultiplier(kind: EmailQualityKind): number {
  switch (kind) {
    case "generic":
      return 0.5;
    case "role":
      return 1.2;
    case "personal":
      return 1.5;
    default:
      return 1;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isMissingMxError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  return code === "ENODATA" || code === "ENOTFOUND";
}

async function resolveMxState(
  domain: string,
  resolveMx: ResolveMx,
  cache: Map<string, boolean | null>
): Promise<boolean | null> {
  if (cache.has(domain)) return cache.get(domain) ?? null;

  try {
    const records = await resolveMx(domain);
    const hasValidMx = records.length > 0;
    cache.set(domain, hasValidMx);
    return hasValidMx;
  } catch (error: unknown) {
    const result = isMissingMxError(error) ? false : null;
    cache.set(domain, result);
    return result;
  }
}

export async function assessEmailQuality(
  emails: string[],
  businessName: string | null | undefined,
  resolveMx: ResolveMx = dns.resolveMx
): Promise<EmailQualityAssessment[]> {
  const cache = new Map<string, boolean | null>();
  const uniqueEmails = Array.from(new Set(
    emails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0 && email.includes("@"))
  ));

  const assessments: EmailQualityAssessment[] = [];

  for (const email of uniqueEmails) {
    const [localPart, domain = ""] = email.split("@");
    const quality = classifyLocalPart(localPart ?? "");
    const matchesBusiness = domainMatchesBusiness(domain, businessName);
    const mxValid = domain ? await resolveMxState(domain, resolveMx, cache) : null;
    const reliabilityMultiplier = round2(
      baseMultiplier(quality) * (matchesBusiness ? 1.1 : 1)
    );

    assessments.push({
      email,
      quality,
      domain_match: matchesBusiness,
      mx_valid: mxValid,
      reliability_multiplier: reliabilityMultiplier,
    });
  }

  return assessments;
}
