import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("playwright", () => ({
  chromium: {
    executablePath: vi.fn(() => "/usr/bin/chromium"),
    launch: vi.fn(async () => ({
      newContext: vi.fn(async () => ({})),
    })),
  },
}));

import { chromium } from "playwright";
import {
  openSocialEnrichBrowser,
  resolvePlaywrightExecutablePath,
} from "../../src/modules/social-enrich/browser.js";

describe("resolvePlaywrightExecutablePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns PLAYWRIGHT_EXECUTABLEPATH when env var is set", () => {
    vi.stubEnv("PLAYWRIGHT_EXECUTABLEPATH", "/custom/chromium");
    expect(resolvePlaywrightExecutablePath()).toBe("/custom/chromium");
  });

  it("returns chromium.executablePath() fallback when env var is not set", () => {
    vi.stubEnv("PLAYWRIGHT_EXECUTABLEPATH", "");
    const path = resolvePlaywrightExecutablePath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });
});

describe("openSocialEnrichBrowser", () => {
  it("launches chromium headless with the resolved executablePath", async () => {
    vi.stubEnv("PLAYWRIGHT_EXECUTABLEPATH", "");
    const session = await openSocialEnrichBrowser();
    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true })
    );
    expect(session.browser).toBeDefined();
    expect(session.context).toBeDefined();
  });
});
