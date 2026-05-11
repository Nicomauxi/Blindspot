import { describe, expect, it } from "vitest";
import { parseWebPhones } from "../../../src/modules/enrichment/parsers/phone-web.js";

describe("parseWebPhones", () => {
  it("prioritizes tel links and normalizes Uruguay mobile numbers", () => {
    const result = parseWebPhones(`
      <html><body>
        <a href="tel:099123456">Llamar</a>
        <p>También 098765432</p>
      </body></html>
    `, null);

    expect(result.phones).toEqual(["+59899123456", "+59898765432"]);
    expect(result.confirmed).toBe(false);
    expect(result.alternatives).toEqual(["+59899123456", "+59898765432"]);
  });

  it("normalizes fixed lines and numbers with +598 prefix", () => {
    const result = parseWebPhones(`
      <html><body>
        <p>Teléfono 24001234</p>
        <p>Ventas +598 29123456</p>
      </body></html>
    `, null);

    expect(result.phones).toEqual(["+59824001234", "+59829123456"]);
  });

  it("confirms the Google Places lead phone when it matches a web phone", () => {
    const result = parseWebPhones(`
      <html><body><a href="tel:+59899123456">Llamar</a></body></html>
    `, "+598 99 123 456");

    expect(result).toEqual({
      phones: ["+59899123456"],
      confirmed: true,
      alternatives: [],
    });
  });

  it("stores different web numbers as alternatives", () => {
    const result = parseWebPhones(`
      <html><body><p>099123456 24001234</p></body></html>
    `, "+59898765432");

    expect(result.confirmed).toBe(false);
    expect(result.alternatives).toEqual(["+59899123456", "+59824001234"]);
  });

  it("returns empty signals when no Uruguay phone is present", () => {
    const result = parseWebPhones("<html><body><p>12345</p></body></html>", null);

    expect(result).toEqual({ phones: [], confirmed: false, alternatives: [] });
  });
});
