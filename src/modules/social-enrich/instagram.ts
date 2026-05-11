import { getLogger } from "../../shared/logger.js";
import type { Lead, PlaywrightInstagramSearchResult, PlaywrightSocialSignal } from "../../shared/types.js";
import type { SocialEnrichPage } from "./facebook.js";
import { normalizeUruguayPhone } from "../enrichment/social-search.js";
import { applyGeographicPenalties } from "./geo-penalty.js";

const NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_BLOCKED_HOSTS = ["about.meta.com", "facebook.com", "instagram.com", "meta.com"];
declare const document: any;

interface InstagramPageData {
  name: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  external_url: string | null;
  has_contact_button: boolean;
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

function extractEmail(raw: string | null): string | null {
  const match = raw?.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

function extractMobilePhone(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b|\b9\d{7}\b/);
  return match ? normalizeUruguayPhone(match[0]) : normalizeUruguayPhone(raw);
}

function confidenceFrom(data: InstagramPageData, lead: Pick<Lead, "name">): {
  confidence: number;
  signals: PlaywrightSocialSignal[];
} {
  const signals: PlaywrightSocialSignal[] = ["page_loaded"];
  let confidence = 0.35;

  if (nameMatches(data.name, lead.name)) {
    signals.push("name_match");
    confidence += 0.35;
  }
  if (data.bio) {
    signals.push("bio_extracted");
    confidence += 0.1;
  }
  if (data.external_url) {
    signals.push("external_url_found");
    confidence += 0.1;
  }
  if (data.has_contact_button) {
    signals.push("contact_button");
    confidence += 0.05;
  }
  if (data.email) {
    signals.push("email_found");
    confidence += 0.05;
  }
  if (data.phone) {
    signals.push("phone_found");
    confidence += 0.05;
  }

  confidence = applyGeographicPenalties(confidence, {
    website: data.external_url,
    description: data.bio,
  });

  return { confidence: Number(Math.min(confidence, 0.95).toFixed(2)), signals };
}

function evaluateInstagramPage({ blockedHosts }: { blockedHosts: string[] }): InstagramPageData {
  const metaTitle = document.querySelector("meta[property='og:title']")?.content ?? null;
  const description =
    document.querySelector("meta[property='og:description']")?.content ??
    document.querySelector("meta[name='description']")?.content ??
    null;
  const profileRoots = Array.from(
    document.querySelectorAll("header, main section, section[role='main']")
  ) as Array<{ querySelectorAll: (selector: string) => Array<{ href: string }> }>;
  const profileAnchors = profileRoots.flatMap((root) =>
    Array.from(root.querySelectorAll("a[href]")) as Array<{ href: string }>
  );
  const external_url =
    profileAnchors.map((anchor) => anchor.href).find((href) => {
      try {
        const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
        return !blockedHosts.some((b) => host === b || host.endsWith(`.${b}`));
      } catch {
        return false;
      }
    }) ?? null;
  const text = document.body?.innerText ?? "";
  const has_contact_button = /\b(contact|email|call|llamar|correo|contacto)\b/i.test(text);

  return {
    name: metaTitle?.split("(@")[0]?.trim() ?? metaTitle,
    bio: description,
    email: `${description ?? ""} ${text}`.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0] ?? null,
    phone: `${description ?? ""} ${text}`.match(/\+598\s?[29]\d{6,7}\b|\b09[1-9]\d{6}\b|\b2\d{7}\b|\b9\d{7}\b/)?.[0] ?? null,
    external_url,
    has_contact_button,
  };
}

export async function extractInstagramProfile(
  page: SocialEnrichPage,
  url: string,
  lead: Pick<Lead, "id" | "name">,
  blockedHosts = DEFAULT_BLOCKED_HOSTS
): Promise<PlaywrightInstagramSearchResult | null> {
  const log = getLogger();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS });
    const extracted = await page.evaluate(
      (args) => evaluateInstagramPage(args),
      { blockedHosts: [...blockedHosts] }
    );
    const data: InstagramPageData = {
      name: cleanText(extracted.name),
      bio: cleanText(extracted.bio),
      email: extractEmail(extracted.email ?? extracted.bio),
      phone: extractMobilePhone(extracted.phone ?? extracted.bio),
      external_url: cleanText(extracted.external_url),
      has_contact_button: extracted.has_contact_button === true,
    };
    const scored = confidenceFrom(data, lead);
    return {
      url,
      ...data,
      confidence: scored.confidence,
      signals: scored.signals,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ leadId: lead.id, platform: "instagram", url, err: msg }, "social enrich navigation failed");
    return null;
  }
}
