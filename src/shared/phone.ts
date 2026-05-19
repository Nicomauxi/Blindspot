export type UruguayPhoneType = "mobile" | "landline" | "unknown";
export type UruguayLandlineRegion = "montevideo" | "interior" | null;

export interface UruguayPhoneClassification {
  phone: string;
  normalized: string | null;
  type: UruguayPhoneType;
  region: UruguayLandlineRegion;
}

function normalizeUruguayNationalDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;

  if (digits.startsWith("598")) {
    const national = digits.slice(3);
    return national.length === 8 ? national : null;
  }

  if (digits.length === 9 && digits.startsWith("0")) {
    return digits.slice(1);
  }

  if (digits.length === 8) {
    return digits;
  }

  return null;
}

function toNormalizedPhone(nationalDigits: string): string {
  if (nationalDigits.startsWith("9")) return `+598${nationalDigits}`;
  return `+598${nationalDigits}`;
}

export function classifyUruguayPhone(phone: string | null | undefined): UruguayPhoneClassification {
  if (!phone) {
    return { phone: "", normalized: null, type: "unknown", region: null };
  }

  const nationalDigits = normalizeUruguayNationalDigits(phone);
  if (!nationalDigits) {
    return { phone, normalized: null, type: "unknown", region: null };
  }

  if (/^9\d{7}$/.test(nationalDigits)) {
    return {
      phone,
      normalized: toNormalizedPhone(nationalDigits),
      type: "mobile",
      region: null,
    };
  }

  if (/^2\d{7}$/.test(nationalDigits)) {
    return {
      phone,
      normalized: toNormalizedPhone(nationalDigits),
      type: "landline",
      region: "montevideo",
    };
  }

  if (/^[34]\d{7}$/.test(nationalDigits)) {
    return {
      phone,
      normalized: toNormalizedPhone(nationalDigits),
      type: "landline",
      region: "interior",
    };
  }

  return {
    phone,
    normalized: toNormalizedPhone(nationalDigits),
    type: "unknown",
    region: null,
  };
}

export function classifyUruguayPhones(
  phones: Array<string | null | undefined>
): UruguayPhoneClassification[] {
  const seen = new Set<string>();
  const results: UruguayPhoneClassification[] = [];

  for (const phone of phones) {
    const classified = classifyUruguayPhone(phone);
    const key = classified.normalized ?? classified.phone;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(classified);
  }

  return results;
}
