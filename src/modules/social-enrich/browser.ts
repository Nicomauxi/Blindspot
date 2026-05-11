import { chromium, type Browser, type BrowserContext } from "playwright";
import { getConfig } from "../../shared/config.js";

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
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolvePlaywrightExecutablePath(),
  });
  const context = await browser.newContext();
  return { browser, context };
}
