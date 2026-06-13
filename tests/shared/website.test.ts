import { describe, expect, it } from "vitest";
import { isRealWebsiteUrl, isSocialHostUrl } from "../../src/shared/website.js";

describe("website url predicates (FS-01)", () => {
  it("treats social profiles / link-in-bio as NOT a real website", () => {
    for (const url of [
      "https://instagram.com/negocio",
      "https://www.facebook.com/negocio",
      "https://linktr.ee/negocio",
      "https://beacons.ai/negocio",
      "https://wa.me/59899111222",
      "https://tiktok.com/@negocio",
    ]) {
      expect(isRealWebsiteUrl(url)).toBe(false);
      expect(isSocialHostUrl(url)).toBe(true);
    }
  });

  it("treats an own domain as a real website", () => {
    expect(isRealWebsiteUrl("https://negocio.com.uy")).toBe(true);
    expect(isSocialHostUrl("https://negocio.com.uy")).toBe(false);
  });

  it("treats empty/null as no website", () => {
    expect(isRealWebsiteUrl(null)).toBe(false);
    expect(isRealWebsiteUrl("")).toBe(false);
    expect(isRealWebsiteUrl("   ")).toBe(false);
  });
});
