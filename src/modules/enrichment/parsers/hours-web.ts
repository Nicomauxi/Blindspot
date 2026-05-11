import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface HoursWebParseResult {
  has_hours_on_web: boolean;
  source: "schema" | "text" | null;
}

const KEYWORD_REGEX = /\b(lunes a viernes|lun(?:es)? a vie(?:rnes)?|horario de atenci[oó]n|horarios|abierto de|de lunes)\b/i;
const WEEKDAY_HOURS_REGEX =
  /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b.{0,40}\b(\d{1,2}(?::\d{2})?)\s*(?:a|-|–|hasta)\s*(\d{1,2}(?::\d{2})?)\b/i;

function emptyResult(): HoursWebParseResult {
  return { has_hours_on_web: false, source: null };
}

function hasOpeningHoursSpec(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasOpeningHoursSpec);
  if (value === null || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  if (record["openingHoursSpecification"] !== undefined) return true;
  if (record["openingHours"] !== undefined) return true;
  if (record["@type"] === "OpeningHoursSpecification") return true;
  if (record["@graph"] !== undefined) return hasOpeningHoursSpec(record["@graph"]);
  return Object.values(record).some(hasOpeningHoursSpec);
}

export function parseHoursOnWeb(html: string): HoursWebParseResult {
  try {
    const $ = cheerio.load(html);
    const jsonLd = $('script[type="application/ld+json"]')
      .map((_, el) => $(el).text())
      .get();

    for (const text of jsonLd) {
      try {
        if (hasOpeningHoursSpec(JSON.parse(text))) {
          return { has_hours_on_web: true, source: "schema" };
        }
      } catch {
        // Ignore malformed JSON-LD and continue with visible text detection.
      }
    }

    $("script, style").remove();
    const visibleText = $("body").text().replace(/\s+/g, " ").trim();
    if (KEYWORD_REGEX.test(visibleText) || WEEKDAY_HOURS_REGEX.test(visibleText)) {
      return { has_hours_on_web: true, source: "text" };
    }

    return emptyResult();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "hours-web", err: msg }, "parser failed");
    return emptyResult();
  }
}
