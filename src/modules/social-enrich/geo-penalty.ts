const FOREIGN_TLDS = new Set([
  "ar",
  "br",
  "cl",
  "co",
  "mx",
  "pe",
  "py",
]);

const FOREIGN_GEO_TERMS = [
  "argentina",
  "buenos aires",
  "brasil",
  "brazil",
  "chile",
  "colombia",
  "mexico",
  "mexico city",
  "méxico",
  "paraguay",
  "peru",
  "perú",
  "santiago de chile",
  "sao paulo",
  "são paulo",
  "tehuacan",
  "tehuacán",
];

const FOREIGN_PHONE_PREFIXES = [
  "+52",
  "+54",
  "+55",
  "+56",
  "+57",
  "+51",
  "+591",
  "+595",
];

interface GeographicPenaltyInput {
  website?: string | null;
  description?: string | null;
  phone?: string | null;
}

export interface GeoCtx {
  foreignTlds?: ReadonlySet<string>;
  foreignGeoTerms?: readonly string[];
  foreignPhonePrefixes?: readonly string[];
}

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hostnameFrom(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    try {
      return new URL(`https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return null;
    }
  }
}

export function hasForeignTld(value: string | null | undefined, ctx?: GeoCtx): boolean {
  const hostname = hostnameFrom(value ?? "");
  if (!hostname) return false;

  const parts = hostname.split(".");
  const tld = parts.at(-1);
  const foreignTlds = ctx?.foreignTlds ?? FOREIGN_TLDS;
  return tld ? foreignTlds.has(tld) : false;
}

export function hasForeignGeoText(value: string | null | undefined, ctx?: GeoCtx): boolean {
  const normalized = asciiFold(value ?? "").toLowerCase();
  if (!normalized) return false;

  const foreignGeoTerms = ctx?.foreignGeoTerms ?? FOREIGN_GEO_TERMS;
  return foreignGeoTerms.some((term) => normalized.includes(asciiFold(term).toLowerCase()));
}

export function hasForeignPhonePrefix(value: string | null | undefined, ctx?: GeoCtx): boolean {
  const normalized = (value ?? "").replace(/[\s().-]+/g, "");
  if (!normalized || normalized.startsWith("+598") || normalized.startsWith("00598")) return false;

  const foreignPhonePrefixes = ctx?.foreignPhonePrefixes ?? FOREIGN_PHONE_PREFIXES;
  return foreignPhonePrefixes.some((prefix) => {
    const digits = prefix.replace("+", "");
    return normalized.startsWith(prefix) || normalized.startsWith(`00${digits}`);
  });
}

export function applyGeographicPenalties(
  confidence: number,
  input: GeographicPenaltyInput,
  ctx?: GeoCtx
): number {
  let penalty = 0;

  if (hasForeignTld(input.website, ctx)) penalty += 0.3;
  if (hasForeignGeoText(input.description, ctx)) penalty += 0.4;
  if (hasForeignPhonePrefix(input.phone, ctx)) penalty += 0.4;

  return Number(Math.max(0, confidence - penalty).toFixed(2));
}
