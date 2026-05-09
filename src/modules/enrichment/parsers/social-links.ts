import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface SocialLinksSignal {
  facebook: string | null;
  instagram: string | null;
  tiktok: string | null;
  count: number;
}

const FB_HOST = /^(https?:)?\/\/(www\.)?facebook\.com\//i;
const IG_HOST = /^(https?:)?\/\/(www\.)?instagram\.com\//i;
const TT_HOST = /^(https?:)?\/\/(www\.)?tiktok\.com\//i;

function pickFirst(
  $: cheerio.CheerioAPI,
  predicate: (href: string) => boolean
): string | null {
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    if (predicate(href)) found = href;
  });
  return found;
}

export function parseSocialLinks(html: string): SocialLinksSignal {
  try {
    const $ = cheerio.load(html);
    const facebook = pickFirst($, (h) => FB_HOST.test(h));
    const instagram = pickFirst($, (h) => IG_HOST.test(h));
    const tiktok = pickFirst($, (h) => TT_HOST.test(h));
    const count = [facebook, instagram, tiktok].filter((x): x is string => !!x).length;
    return { facebook, instagram, tiktok, count };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "social-links", err: msg }, "parser failed");
    return { facebook: null, instagram: null, tiktok: null, count: 0 };
  }
}
