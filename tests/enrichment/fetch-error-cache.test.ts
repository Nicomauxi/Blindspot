import { describe, expect, it } from "vitest";
import { isPermanentFetchError } from "../../src/modules/enrichment/index.js";

// F4.4: errores permanentes se cachean (no re-fetch); transitorios se reintentan.
describe("isPermanentFetchError (F4.4)", () => {
  it("permanentes: 4xx (salvo 408/429), non-html, URL inválida", () => {
    expect(isPermanentFetchError("http-404")).toBe(true);
    expect(isPermanentFetchError("http-403")).toBe(true);
    expect(isPermanentFetchError("http-410")).toBe(true);
    expect(isPermanentFetchError("http-400")).toBe(true);
    expect(isPermanentFetchError("non-html-content")).toBe(true);
    expect(isPermanentFetchError("invalid-domain")).toBe(true);
  });

  it("transitorios: 5xx, 429, 408, red, read-body, desconocido", () => {
    expect(isPermanentFetchError("http-500")).toBe(false);
    expect(isPermanentFetchError("http-503")).toBe(false);
    expect(isPermanentFetchError("http-429")).toBe(false);
    expect(isPermanentFetchError("http-408")).toBe(false);
    expect(isPermanentFetchError("network: ECONNRESET")).toBe(false);
    expect(isPermanentFetchError("read-body: boom")).toBe(false);
    expect(isPermanentFetchError("unknown-fetch-error")).toBe(false);
  });
});
