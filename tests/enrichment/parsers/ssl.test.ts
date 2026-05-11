import { describe, expect, it } from "vitest";
import { parseSsl } from "../../../src/modules/enrichment/parsers/ssl.js";

describe("parseSsl", () => {
  it("returns valid_https=false and cert_valid=null for null input", () => {
    const result = parseSsl(null);
    expect(result.valid_https).toBe(false);
    expect(result.cert_valid).toBeNull();
  });

  it("returns valid_https=false for http URL", () => {
    const result = parseSsl("http://example.com");
    expect(result.valid_https).toBe(false);
    expect(result.cert_valid).toBeNull();
  });

  it("returns valid_https=true for https URL", () => {
    const result = parseSsl("https://example.com");
    expect(result.valid_https).toBe(true);
    expect(result.cert_valid).toBeNull();
  });

  it("is case-insensitive for HTTPS", () => {
    const result = parseSsl("HTTPS://example.com");
    expect(result.valid_https).toBe(true);
  });
});
