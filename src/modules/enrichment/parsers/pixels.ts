import { getLogger } from "../../../shared/logger.js";

export interface PixelHit {
  present: boolean;
  id: string | null;
}

export interface PixelsSignal {
  meta_pixel: PixelHit;
  ga4: PixelHit;
  ga_universal: PixelHit;
  gtm: PixelHit;
}

const META_PIXEL_INIT = /fbq\s*\(\s*['"]init['"]/i;
const META_PIXEL_SCRIPT = /connect\.facebook\.net\/[^/]+\/fbevents\.js/i;
const META_PIXEL_ID = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/i;

const GA4_CONFIG = /gtag\s*\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/i;
const GA4_SCRIPT = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/i;

const GA_UNIVERSAL_CREATE = /\bga\s*\(\s*['"]create['"]/i;
const GA_UNIVERSAL_SCRIPT = /google-analytics\.com\/analytics\.js/i;
const GA_UNIVERSAL_ID = /(UA-\d+-\d+)/i;

const GTM_SCRIPT = /googletagmanager\.com\/gtm\.js/i;
const GTM_ID = /(GTM-[A-Z0-9]+)/;

function emptyPixelsSignal(): PixelsSignal {
  return {
    meta_pixel: { present: false, id: null },
    ga4: { present: false, id: null },
    ga_universal: { present: false, id: null },
    gtm: { present: false, id: null },
  };
}

export function parsePixels(html: string): PixelsSignal {
  try {
    const meta_pixel_present = META_PIXEL_INIT.test(html) || META_PIXEL_SCRIPT.test(html);
    const meta_pixel_id = META_PIXEL_ID.exec(html)?.[1] ?? null;

    const ga4_match = GA4_CONFIG.exec(html) ?? GA4_SCRIPT.exec(html);
    const ga4_present = !!ga4_match;
    const ga4_id = ga4_match?.[1] ?? null;

    const ga_universal_present =
      GA_UNIVERSAL_CREATE.test(html) || GA_UNIVERSAL_SCRIPT.test(html) || GA_UNIVERSAL_ID.test(html);
    const ga_universal_id = GA_UNIVERSAL_ID.exec(html)?.[1] ?? null;

    const gtm_match = GTM_ID.exec(html);
    const gtm_present = GTM_SCRIPT.test(html) || !!gtm_match;
    const gtm_id = gtm_match?.[1] ?? null;

    return {
      meta_pixel: { present: meta_pixel_present, id: meta_pixel_id },
      ga4: { present: ga4_present, id: ga4_id },
      ga_universal: { present: ga_universal_present, id: ga_universal_id },
      gtm: { present: gtm_present, id: gtm_id },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "pixels", err: msg }, "parser failed");
    return emptyPixelsSignal();
  }
}
