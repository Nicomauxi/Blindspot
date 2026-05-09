import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface ViewportSignal {
  present: boolean;
  content: string | null;
}

export function parseViewport(html: string): ViewportSignal {
  try {
    const $ = cheerio.load(html);
    const content = $('meta[name="viewport"]').attr("content");
    if (typeof content === "string" && content.length > 0) {
      return { present: true, content };
    }
    return { present: false, content: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "viewport", err: msg }, "parser failed");
    return { present: false, content: null };
  }
}
