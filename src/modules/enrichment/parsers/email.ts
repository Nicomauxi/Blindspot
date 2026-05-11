import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@(?:[a-zA-Z0-9\-]+\.)+(?:com\.uy|gub\.uy|uy|[a-zA-Z]{2,3}(?![a-zA-Z]))/g;
const MAX_EMAILS = 3;

const BLOCKED_DOMAINS = new Set([
  "sentry.io",
  "example.com",
  "test.com",
  "wixpress.com",
  "squarespace.com",
  "shopify.com",
  "wordpress.com",
  "googletagmanager.com",
  "facebook.com",
  "instagram.com",
  "thinkit.com.uy",
  "smartserv.com.uy",
  "hosting.com.uy",
  "hosteruy.com.uy",
  "uruhost.com.uy",
  "datamedios.com.uy",
  "websitio.com.uy",
  "enaming.com",
]);

const BLOCKED_PREFIXES = ["noreply", "no-reply", "mailer", "bounce"];

export interface EmailParseResult {
  emails: string[];
  has_contact_email: boolean;
}

function emptyResult(): EmailParseResult {
  return { emails: [], has_contact_email: false };
}

function normalizeEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").split("?")[0]?.toLowerCase() ?? "";
}

function isUsefulEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return false;
  const lowerDomain = domain.toLowerCase();
  if (BLOCKED_DOMAINS.has(lowerDomain)) return false;
  return !BLOCKED_PREFIXES.some(
    (prefix) => local.toLowerCase().startsWith(prefix) || lowerDomain.startsWith(prefix)
  );
}

function collectEmails(text: string): string[] {
  return (text.match(EMAIL_REGEX) ?? [])
    .map(normalizeEmail)
    .filter((email) => email.length > 0 && isUsefulEmail(email));
}

function uniqueLimited(values: string[]): string[] {
  return Array.from(new Set(values)).slice(0, MAX_EMAILS);
}

export function parseEmails(html: string): EmailParseResult {
  try {
    const $ = cheerio.load(html);
    const mailtoEmails = $('a[href^="mailto:" i]')
      .map((_, el) => normalizeEmail($(el).attr("href") ?? ""))
      .get()
      .filter((email) => email.length > 0 && isUsefulEmail(email));

    $("script, style").remove();
    const textEmails = collectEmails($("body").text());
    const emails = uniqueLimited([...mailtoEmails, ...textEmails]);

    return { emails, has_contact_email: emails.length > 0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "email", err: msg }, "parser failed");
    return emptyResult();
  }
}
