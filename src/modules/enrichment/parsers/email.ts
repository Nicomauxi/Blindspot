import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";

const EMAIL_REGEX =
  /(?<![A-Za-z0-9._%+\-])([A-Za-z0-9][A-Za-z0-9_%+\-]{0,62}(?:\.[A-Za-z0-9][A-Za-z0-9_%+\-]{0,62})*)@((?:[A-Za-z0-9\-]+\.)+(?:com\.uy|gub\.uy|uy|[A-Za-z]{2,3}(?![A-Za-z])))/g;
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
const FREE_EMAIL_DOMAINS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com"]);
const SUSPICIOUS_LOCAL_TLD_SUFFIX = /\.(?:com|net|org|info|uy|comuy)$/i;

export interface EmailParseResult {
  emails: string[];
  has_contact_email: boolean;
}

export interface EmailParseCtx {
  blockedDomains?: ReadonlySet<string>;
  freeDomains?: ReadonlySet<string>;
  blockedPrefixes?: readonly string[];
  foreignEmailTlds?: ReadonlySet<string>;
}

function emptyResult(): EmailParseResult {
  return { emails: [], has_contact_email: false };
}

function normalizeEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").split("?")[0]?.toLowerCase() ?? "";
}

function isUsefulEmail(email: string, ctx?: EmailParseCtx): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (local.includes("..")) return false;
  const lowerDomain = domain.toLowerCase();
  const freeDomains = ctx?.freeDomains ?? FREE_EMAIL_DOMAINS;
  const blockedDomains = ctx?.blockedDomains ?? BLOCKED_DOMAINS;
  const blockedPrefixes = ctx?.blockedPrefixes ?? BLOCKED_PREFIXES;
  if (freeDomains.has(lowerDomain) && SUSPICIOUS_LOCAL_TLD_SUFFIX.test(local)) return false;
  if (blockedDomains.has(lowerDomain)) return false;
  if (ctx?.foreignEmailTlds) {
    const domainParts = lowerDomain.split(".");
    const tld1 = domainParts.at(-1);
    const tld2 = domainParts.length >= 2
      ? `${domainParts.at(-2)}.${domainParts.at(-1)}`
      : null;
    if (
      (tld1 && ctx.foreignEmailTlds.has(tld1)) ||
      (tld2 && ctx.foreignEmailTlds.has(tld2))
    ) {
      return false;
    }
  }
  return !blockedPrefixes.some(
    (prefix) => local.toLowerCase().startsWith(prefix) || lowerDomain.startsWith(prefix)
  );
}

function collectEmails(text: string, ctx?: EmailParseCtx): string[] {
  return (text.match(EMAIL_REGEX) ?? [])
    .map(normalizeEmail)
    .filter((email) => email.length > 0 && isUsefulEmail(email, ctx));
}

function uniqueLimited(values: string[]): string[] {
  return Array.from(new Set(values)).slice(0, MAX_EMAILS);
}

export function parseEmails(html: string, ctx?: EmailParseCtx): EmailParseResult {
  try {
    const $ = cheerio.load(html);
    const mailtoEmails = $('a[href^="mailto:" i]')
      .map((_, el) => normalizeEmail($(el).attr("href") ?? ""))
      .get()
      .filter((email) => email.length > 0 && isUsefulEmail(email, ctx));

    $("script, style").remove();
    const textEmails = collectEmails($("body").text(), ctx);
    const emails = uniqueLimited([...mailtoEmails, ...textEmails]);

    return { emails, has_contact_email: emails.length > 0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "email", err: msg }, "parser failed");
    return emptyResult();
  }
}
