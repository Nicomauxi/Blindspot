import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
import { getConfig } from "../../shared/config.js";
import { getScrapingConfig } from "../discovery/config.js";
import { pickRandom } from "../../shared/scraping.js";

chromium.use(StealthPlugin());

export interface SocialEnrichBrowserSession {
  browser: Browser;
  context: BrowserContext;
}

export function resolvePlaywrightExecutablePath(): string {
  const configured = getConfig().PLAYWRIGHT_EXECUTABLEPATH?.trim();
  return configured && configured.length > 0
    ? configured
    : chromium.executablePath();
}

export async function openSocialEnrichBrowser(): Promise<SocialEnrichBrowserSession> {
  const scrapingCfg = getScrapingConfig();
  const ua = pickRandom(scrapingCfg.social_ua_pool);
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolvePlaywrightExecutablePath(),
  });
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1280, height: 800 },
    locale: "es-UY",
    timezoneId: "America/Montevideo",
  });
  return { browser, context };
}
