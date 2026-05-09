import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface WhatsappSignal {
  present: boolean;
  numbers: string[];
  source: "link" | "button-heuristic" | null;
}

const WA_ME_NUMBER = /(?:wa\.me\/|api\.whatsapp\.com\/send\?[^"']*phone=)[+]?(\d{6,15})/i;
const PHONE_DIGITS = /(\d{6,15})/;

function normalizeNumber(raw: string): string {
  // Strip all non-digit chars, keep digits only.
  return raw.replace(/[^\d]/g, "");
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
        numbersSet.add(normalizeNumber(m[1]));
        return;
      }
      const m2 = PHONE_DIGITS.exec(href);
      if (m2 && m2[1]) numbersSet.add(normalizeNumber(m2[1]));
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
