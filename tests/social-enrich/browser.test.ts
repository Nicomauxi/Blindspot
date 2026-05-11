import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(() => ({ PLAYWRIGHT_EXECUTABLEPATH: undefined as string | undefined })),
}));

vi.mock("../../src/shared/config.js", () => ({
  getConfig: mockGetConfig,
}));

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
    mockGetConfig.mockReturnValue({ PLAYWRIGHT_EXECUTABLEPATH: undefined });
  });

  it("returns PLAYWRIGHT_EXECUTABLEPATH when configured", () => {
    mockGetConfig.mockReturnValue({ PLAYWRIGHT_EXECUTABLEPATH: "/custom/chromium" });
    expect(resolvePlaywrightExecutablePath()).toBe("/custom/chromium");
  });

  it("returns chromium.executablePath() fallback when not configured", () => {
    mockGetConfig.mockReturnValue({ PLAYWRIGHT_EXECUTABLEPATH: undefined });
    const path = resolvePlaywrightExecutablePath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });
});

describe("openSocialEnrichBrowser", () => {
  it("launches chromium headless with the resolved executablePath", async () => {
    mockGetConfig.mockReturnValue({ PLAYWRIGHT_EXECUTABLEPATH: undefined });
    const session = await openSocialEnrichBrowser();
    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true })
    );
    expect(session.browser).toBeDefined();
    expect(session.context).toBeDefined();
  });
});
