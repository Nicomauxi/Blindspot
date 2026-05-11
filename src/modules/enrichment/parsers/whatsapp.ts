import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface WhatsappSignal {
  present: boolean;
  numbers: string[];
  source: "link" | "button-heuristic" | null;
}

const WA_ME_NUMBER = /(?:wa\.me\/|api\.whatsapp\.com\/send\?[^"']*phone=)[+]?(\d{6,15})/i;
const PHONE_DIGITS = /(\d{6,15})/;
const UY_MOBILE_PREFIXES = new Set(["91", "92", "93", "94", "95", "96", "97", "98", "99"]);

export function normalizeUruguayMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let local: string | null = null;
  let localTrunk = false;

  if (digits.length === 9 && digits.startsWith("09")) {
    local = digits.slice(1);
    localTrunk = true;
  } else if (digits.length === 11 && digits.startsWith("5989")) {
    local = digits.slice(3);
  } else if (digits.length === 13 && digits.startsWith("005989")) {
    local = digits.slice(5);
  }

  if (!local || local.length !== 8) return null;
  if (localTrunk && (local.startsWith("91") || local.startsWith("99"))) return null;
  if (!UY_MOBILE_PREFIXES.has(local.slice(0, 2))) return null;
  return `+598${local}`;
}

export function parseWhatsapp(html: string): WhatsappSignal {
  try {
    const $ = cheerio.load(html);
    const numbersSet = new Set<string>();

    // Direct WhatsApp links.
    $('a[href*="wa.me/"], a[href*="api.whatsapp.com/send"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const m = WA_ME_NUMBER.exec(href);
      if (m && m[1]) {
        const normalized = normalizeUruguayMobile(m[1]);
        if (normalized) numbersSet.add(normalized);
        return;
      }
      const m2 = PHONE_DIGITS.exec(href);
      if (m2 && m2[1]) {
        const normalized = normalizeUruguayMobile(m2[1]);
        if (normalized) numbersSet.add(normalized);
      }
    });

    if (numbersSet.size > 0) {
      return { present: true, numbers: Array.from(numbersSet), source: "link" };
    }

    // Button heuristic — class/id containing "whatsapp", "wa-".
    const heuristicCount = $(
      '[class*="whatsapp" i], [class*="wa-" i], [id*="whatsapp" i]'
    ).length;
    if (heuristicCount > 0) {
      return { present: true, numbers: [], source: "button-heuristic" };
    }

    return { present: false, numbers: [], source: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "whatsapp", err: msg }, "parser failed");
    return { present: false, numbers: [], source: null };
  }
}
