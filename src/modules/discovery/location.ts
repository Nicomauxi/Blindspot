const COUNTRY_STOP_WORDS = new Set([
  "uruguay",
  "uy",
  "departamento",
  "depto",
  "department",
  "ciudad",
]);

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function cleanToken(token: string): string {
  return stripDiacritics(token)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeLocationLabel(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "Sin ubicación";

  const cleaned = cleanToken(raw);
  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !COUNTRY_STOP_WORDS.has(token));

  if (tokens.length === 0) {
    return titleCase(cleaned || raw);
  }

  return titleCase(tokens.join(" "));
}

export function buildLocationKey(input: string | null | undefined): string {
  return normalizeLocationLabel(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveLocationLabelFromAddress(address: string | null | undefined): string {
  const raw = (address ?? "").trim();
  if (!raw) return "Sin ubicación";

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
    const normalized = normalizeLocationLabel(parts[idx]);
    if (normalized !== "Sin ubicación" && normalized !== "Uruguay") {
      return normalized;
    }
  }

  return normalizeLocationLabel(raw);
}
