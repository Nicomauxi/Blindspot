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

export function hasForeignTld(value: string | null | undefined): boolean {
  const hostname = hostnameFrom(value ?? "");
  if (!hostname) return false;

  const parts = hostname.split(".");
  const tld = parts.at(-1);
  return tld ? FOREIGN_TLDS.has(tld) : false;
}

export function hasForeignGeoText(value: string | null | undefined): boolean {
  const normalized = asciiFold(value ?? "").toLowerCase();
  if (!normalized) return false;

  return FOREIGN_GEO_TERMS.some((term) => normalized.includes(asciiFold(term).toLowerCase()));
}

export function hasForeignPhonePrefix(value: string | null | undefined): boolean {
  const normalized = (value ?? "").replace(/[\s().-]+/g, "");
  if (!normalized || normalized.startsWith("+598") || normalized.startsWith("00598")) return false;

  return FOREIGN_PHONE_PREFIXES.some((prefix) => {
    const digits = prefix.replace("+", "");
    return normalized.startsWith(prefix) || normalized.startsWith(`00${digits}`);
  });
}

export function applyGeographicPenalties(
  confidence: number,
  input: GeographicPenaltyInput
): number {
  let penalty = 0;

  if (hasForeignTld(input.website)) penalty += 0.3;
  if (hasForeignGeoText(input.description)) penalty += 0.4;
  if (hasForeignPhonePrefix(input.phone)) penalty += 0.4;

  return Number(Math.max(0, confidence - penalty).toFixed(2));
}
