import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

const PHONE_REGEX = /\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b/g;

export interface WebPhoneParseResult {
  phones: string[];
  confirmed: boolean;
  alternatives: string[];
}

function emptyResult(): WebPhoneParseResult {
  return { phones: [], confirmed: false, alternatives: [] };
}

export function normalizeUruguayWebPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 0) return null;

  if (digits.startsWith("598")) {
    const national = digits.slice(3);
    if (/^[29]\d{7}$/.test(national)) return `+598${national}`;
    return null;
  }

  if (/^09[1-9]\d{6}$/.test(digits)) return `+598${digits.slice(1)}`;
  if (/^[29]\d{7}$/.test(digits)) return `+598${digits}`;
  return null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseWebPhones(html: string, leadPhone: string | null | undefined): WebPhoneParseResult {
  try {
    const $ = cheerio.load(html);
    const telPhones = $('a[href^="tel:" i]')
      .map((_, el) => normalizeUruguayWebPhone(($(el).attr("href") ?? "").replace(/^tel:/i, "")))
      .get()
      .filter((phone): phone is string => phone !== null);

    $("script, style").remove();
    const textPhones = ($("body").text().match(PHONE_REGEX) ?? [])
      .map(normalizeUruguayWebPhone)
      .filter((phone): phone is string => phone !== null);

    const phones = unique([...telPhones, ...textPhones]);
    const normalizedLeadPhone = normalizeUruguayWebPhone(leadPhone);
    const confirmed = normalizedLeadPhone !== null && phones.includes(normalizedLeadPhone);
    const alternatives = normalizedLeadPhone === null
      ? phones
      : phones.filter((phone) => phone !== normalizedLeadPhone);

    return { phones, confirmed, alternatives };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "phone-web", err: msg }, "parser failed");
    return emptyResult();
  }
}
