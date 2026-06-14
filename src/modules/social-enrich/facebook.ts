import { getLogger } from "../../shared/logger.js";
import type { Lead, PlaywrightFacebookSearchResult, PlaywrightSocialSignal } from "../../shared/types.js";
import { normalizeUruguayPhone } from "../enrichment/social-search.js";
import { applyGeographicPenalties } from "./geo-penalty.js";
import { detectLiveness, isHardDead } from "./liveness.js";

const NAVIGATION_TIMEOUT_MS = 15_000;
declare const document: any;

export interface SocialEnrichPage {
  goto: (
    url: string,
    opts: { waitUntil: "domcontentloaded"; timeout: number }
  ) => Promise<unknown>;
  waitForLoadState: (
    state: "networkidle",
    opts: { timeout: number }
  ) => Promise<unknown>;
  evaluate: {
    <T>(fn: () => T): Promise<T>;
    <T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  };
}

interface FacebookPageData {
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  whatsapp_button: boolean;
  og_title: string | null;
  page_title: string | null;
  h1: string | null;
  final_url: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function asciiFold(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizedTokens(input: string | null | undefined): string[] {
  return asciiFold(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function nameMatches(extractedName: string | null, leadName: string): boolean {
  const extracted = new Set(normalizedTokens(extractedName));
  const expected = normalizedTokens(leadName);
  if (expected.length === 0 || extracted.size === 0) return false;
  const overlap = expected.filter((token) => extracted.has(token)).length;
  return overlap / expected.length >= 0.5;
}

function extractMobilePhone(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b|\b9\d{7}\b/);
  return match ? normalizeUruguayPhone(match[0]) : normalizeUruguayPhone(raw);
}

function extractEmail(raw: string | null): string | null {
  const match = raw?.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

function confidenceFrom(data: FacebookPageData, lead: Pick<Lead, "name">): {
  confidence: number;
  signals: PlaywrightSocialSignal[];
} {
  const signals: PlaywrightSocialSignal[] = ["page_loaded"];
  let confidence = 0.35;

  if (nameMatches(data.name, lead.name)) {
    signals.push("name_match");
    confidence += 0.35;
  }
  if (data.phone) {
    signals.push("phone_found");
    confidence += 0.15;
  }
  if (data.email) {
    signals.push("email_found");
    confidence += 0.05;
  }
  if (data.website) {
    signals.push("website_found");
    confidence += 0.05;
  }
  if (data.description) {
    signals.push("description_found");
    confidence += 0.05;
  }
  if (data.whatsapp_button) {
    signals.push("whatsapp_button");
    confidence += 0.05;
  }

  confidence = applyGeographicPenalties(confidence, {
    website: data.website,
    description: data.description,
  });

  return { confidence: Number(Math.min(confidence, 0.95).toFixed(2)), signals };
}

function evaluateFacebookPage(): FacebookPageData {
  const text = document.body?.innerText ?? "";
  const metaTitle = document.querySelector("meta[property='og:title']")?.content ?? null;
  const h1 = document.querySelector("h1")?.textContent ?? null;
  const description =
    document.querySelector("meta[property='og:description']")?.content ??
    document.querySelector("meta[name='description']")?.content ??
    null;
  const anchors = Array.from(document.querySelectorAll("a[href]")) as Array<{ href: string }>;
  const externalLink = anchors
    .map((anchor) => anchor.href)
    .find((href) => {
      try {
        const host = new URL(href).hostname.toLowerCase();
        return !host.includes("facebook.com") && !host.includes("fb.com") && !host.includes("whatsapp.com") && host !== "wa.me";
      } catch {
        return false;
      }
    }) ?? null;
  const whatsapp_button = anchors.some((anchor) => /wa\.me|api\.whatsapp\.com/i.test(anchor.href));
  const phone = text.match(/\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b|\b9\d{7}\b/)?.[0] ?? null;

  const pageTitle = document.querySelector("title")?.textContent ?? null;

  return {
    name: metaTitle ?? h1,
    email: text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0] ?? null,
    phone,
    website: externalLink,
    description,
    whatsapp_button,
    og_title: metaTitle,
    page_title: pageTitle,
    h1,
    final_url: document.location?.href ?? null,
  };
}

export async function extractFacebookProfile(
  page: SocialEnrichPage,
  url: string,
  lead: Pick<Lead, "id" | "name">
): Promise<PlaywrightFacebookSearchResult | null> {
  const log = getLogger();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS });
    const extracted = await page.evaluate(evaluateFacebookPage);

    // Liveness: si la página está hard-dead (borrada/redirigida/título genérico) no se
    // confirma ni se incluye como red del lead — así filtramos el ruido en la asignación.
    const liveness = detectLiveness({
      platform: "facebook",
      requestedUrl: url,
      finalUrl: extracted.final_url ?? url,
      httpStatus: 200,
      ogTitle: extracted.og_title,
      title: extracted.page_title,
      h1: extracted.h1,
      ogDescription: extracted.description,
      checkedAt: new Date().toISOString(),
    });
    if (isHardDead(liveness)) {
      log.info({ leadId: lead.id, platform: "facebook", url, reason: liveness.reason }, "social enrich: página muerta descartada");
      return null;
    }

    const data: FacebookPageData = {
      name: cleanText(extracted.name),
      email: extractEmail(extracted.email),
      phone: extractMobilePhone(extracted.phone),
      website: cleanText(extracted.website),
      description: cleanText(extracted.description),
      whatsapp_button: extracted.whatsapp_button === true,
      og_title: extracted.og_title,
      page_title: extracted.page_title,
      h1: extracted.h1,
      final_url: extracted.final_url,
    };
    const scored = confidenceFrom(data, lead);
    return {
      url,
      name: data.name,
      email: data.email,
      phone: data.phone,
      website: data.website,
      description: data.description,
      whatsapp_button: data.whatsapp_button,
      confidence: scored.confidence,
      signals: scored.signals,
      liveness,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ leadId: lead.id, platform: "facebook", url, err: msg }, "social enrich navigation failed");
    return null;
  }
}
