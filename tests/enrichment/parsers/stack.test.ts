import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseStack } from "../../../src/modules/enrichment/parsers/stack.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
function load(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parseStack", () => {
  it("detects WordPress with high confidence + version from meta generator", () => {
    const r = parseStack(load("wordpress-pixel.html"), {});
    expect(r).not.toBeNull();
    expect(r?.name).toBe("WordPress");
    expect(r?.confidence).toBe("high");
    expect(r?.version).toBe("4.9.18");
  });

  it("detects WordPress with medium confidence via wp-content when generator missing", () => {
    const html = `<html><body><img src="/wp-content/uploads/x.jpg"></body></html>`;
    const r = parseStack(html, {});
    expect(r?.name).toBe("WordPress");
    expect(r?.confidence).toBe("medium");
    expect(r?.version).toBeNull();
  });

  it("detects Shopify via cdn.shopify.com signature", () => {
    const r = parseStack(load("shopify-ga4.html"), {});
    expect(r?.name).toBe("Shopify");
  });

  it("detects Tiendanube via cdn.tiendanube.com (high)", () => {
    const r = parseStack(load("tiendanube-vintage.html"), {});
    expect(r?.name).toBe("Tiendanube");
    expect(r?.confidence).toBe("high");
  });

  it("detects Wix via wixstatic.com signature", () => {
    const r = parseStack(load("wix-with-whatsapp.html"), {});
    expect(r?.name).toBe("Wix");
  });

  it("detects Squarespace via meta generator (high)", () => {
    const r = parseStack(load("squarespace-clean.html"), {});
    expect(r?.name).toBe("Squarespace");
    expect(r?.confidence).toBe("high");
  });

  it("returns null when no signatures match", () => {
    const r = parseStack(load("plain-static.html"), {});
    expect(r).toBeNull();
  });
});
