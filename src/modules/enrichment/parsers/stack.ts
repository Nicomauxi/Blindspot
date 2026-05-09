import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

export interface StackSignal {
  name: string;
  version: string | null;
  confidence: "high" | "medium" | "low";
}

interface SignatureContext {
  html: string;
  headers: Record<string, string>;
  generator: string | null;
}

interface SignatureCheck {
  name: string;
  detect: (ctx: SignatureContext) => StackSignal | null;
}

function readGenerator(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const c = $('meta[name="generator"]').attr("content");
    return typeof c === "string" && c.length > 0 ? c : null;
  } catch {
    return null;
  }
}

const SIGNATURES: SignatureCheck[] = [
  // WordPress
  {
    name: "WordPress",
    detect: ({ html, generator }) => {
      const wpGen = generator && /^WordPress\b/i.test(generator);
      if (wpGen && generator) {
        const v = /WordPress\s+([\d.]+)/i.exec(generator)?.[1] ?? null;
        return { name: "WordPress", version: v, confidence: "high" };
      }
      const cdnHits =
        /\bwp-content\//i.test(html) || /\bwp-includes\//i.test(html);
      if (cdnHits) {
        return { name: "WordPress", version: null, confidence: "medium" };
      }
      return null;
    },
  },
  // Shopify
  {
    name: "Shopify",
    detect: ({ html, generator }) => {
      if (generator && /shopify/i.test(generator)) {
        return { name: "Shopify", version: null, confidence: "high" };
      }
      const strong =
        /cdn\.shopify\.com/i.test(html) ||
        /Shopify\.theme/i.test(html) ||
        /\.myshopify\.com/i.test(html);
      if (strong) return { name: "Shopify", version: null, confidence: "medium" };
      return null;
    },
  },
  // Wix
  {
    name: "Wix",
    detect: ({ html, headers }) => {
      const headerHit = Object.keys(headers).some((k) => k.toLowerCase().startsWith("x-wix-"));
      const strong =
        headerHit ||
        /static\.wixstatic\.com/i.test(html) ||
        /\bwix\.com\b/i.test(html);
      if (strong) return { name: "Wix", version: null, confidence: "medium" };
      return null;
    },
  },
  // Tiendanube
  {
    name: "Tiendanube",
    detect: ({ html }) => {
      const strong =
        /tiendanube\.com/i.test(html) ||
        /mitiendanube\.com/i.test(html) ||
        /cdn\.tiendanube\.com/i.test(html);
      if (strong) return { name: "Tiendanube", version: null, confidence: "high" };
      return null;
    },
  },
  // Squarespace
  {
    name: "Squarespace",
    detect: ({ html, generator }) => {
      if (generator && /squarespace/i.test(generator)) {
        return { name: "Squarespace", version: null, confidence: "high" };
      }
      const strong =
        /static1\.squarespace\.com/i.test(html) ||
        /\bsquarespace\.com\b/i.test(html);
      if (strong) return { name: "Squarespace", version: null, confidence: "medium" };
      return null;
    },
  },
  // Webflow
  {
    name: "Webflow",
    detect: ({ html, generator }) => {
      if (generator && /webflow/i.test(generator)) {
        return { name: "Webflow", version: null, confidence: "high" };
      }
      const strong =
        /\bwebflow\.com\b/i.test(html) || /assets\.website-files\.com/i.test(html);
      if (strong) return { name: "Webflow", version: null, confidence: "medium" };
      return null;
    },
  },
  // Joomla
  {
    name: "Joomla",
    detect: ({ generator }) => {
      if (generator && /joomla/i.test(generator)) {
        const v = /Joomla[!\s]*([\d.]+)/i.exec(generator)?.[1] ?? null;
        return { name: "Joomla", version: v, confidence: "high" };
      }
      return null;
    },
  },
  // Drupal
  {
    name: "Drupal",
    detect: ({ generator }) => {
      if (generator && /drupal/i.test(generator)) {
        const v = /Drupal\s+([\d.]+)/i.exec(generator)?.[1] ?? null;
        return { name: "Drupal", version: v, confidence: "high" };
      }
      return null;
    },
  },
];

export function parseStack(
  html: string,
  headers: Record<string, string>
): StackSignal | null {
  try {
    const generator = readGenerator(html);
    const ctx: SignatureContext = { html, headers, generator };
    for (const sig of SIGNATURES) {
      const hit = sig.detect(ctx);
      if (hit) return hit;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "stack", err: msg }, "parser failed");
    return null;
  }
}
