import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("undici", () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));

import {
  USER_AGENT,
  getFetchTimeoutMs,
  getFetchRetries,
  ensureScheme,
  fetchHtml,
} from "../../src/modules/enrichment/http.js";

describe("USER_AGENT", () => {
  it("is not empty", () => {
    expect(USER_AGENT.length).toBeGreaterThan(0);
  });

  it("does not contain the yourorg placeholder", () => {
    expect(USER_AGENT).not.toContain("yourorg");
  });
});

// Los knobs de velocidad se leen del env POR LLAMADA (no al arranque del proceso):
// la API los settea desde pipeline_config al lanzar jobs sin reiniciar.
describe("getFetchTimeoutMs / getFetchRetries", () => {
  afterEach(() => {
    delete process.env["FETCH_TIMEOUT_MS"];
    delete process.env["FETCH_RETRIES"];
  });

  it("usa defaults sin env (8000 ms / 2 retries)", () => {
    expect(getFetchTimeoutMs()).toBe(8000);
    expect(getFetchRetries()).toBe(2);
  });

  it("lee el env en cada llamada (cambia en runtime)", () => {
    process.env["FETCH_TIMEOUT_MS"] = "5000";
    process.env["FETCH_RETRIES"] = "0";
    expect(getFetchTimeoutMs()).toBe(5000);
    expect(getFetchRetries()).toBe(0);

    process.env["FETCH_TIMEOUT_MS"] = "3000";
    process.env["FETCH_RETRIES"] = "1";
    expect(getFetchTimeoutMs()).toBe(3000);
    expect(getFetchRetries()).toBe(1);
  });

  it("cae al default con valores inválidos", () => {
    process.env["FETCH_TIMEOUT_MS"] = "no-numérico";
    process.env["FETCH_RETRIES"] = "-3";
    expect(getFetchTimeoutMs()).toBe(8000);
    expect(getFetchRetries()).toBe(2);
  });
});

describe("ensureScheme", () => {
  it("agrega https a URLs sin esquema", () => {
    expect(ensureScheme("www.foo.com")).toBe("https://www.foo.com");
    expect(ensureScheme("foo.com.uy/path")).toBe("https://foo.com.uy/path");
  });

  it("respeta el esquema existente (no lo duplica ni cambia)", () => {
    expect(ensureScheme("https://foo.com")).toBe("https://foo.com");
    expect(ensureScheme("http://foo.com")).toBe("http://foo.com");
    expect(ensureScheme("HTTPS://Foo.com")).toBe("HTTPS://Foo.com");
  });
});

function htmlResponse(html: string) {
  return {
    status: 200,
    url: undefined,
    headers: { forEach: (cb: (v: string, k: string) => void) => cb("text/html", "content-type") },
    body: null, // body null → fetchHtml devuelve html:"" sin error; suficiente para el path de éxito
  };
}

describe("fetchHtml — ensureScheme + fallback http (F1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["FETCH_RETRIES"] = "0"; // sin reintentos: tests rápidos y deterministas
  });
  afterEach(() => {
    delete process.env["FETCH_RETRIES"];
  });

  it("una URL sin esquema se intenta como https:// (no falla por URL inválida)", async () => {
    mockFetch.mockResolvedValueOnce(htmlResponse(""));
    const res = await fetchHtml("www.foo.com");
    expect(res.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://www.foo.com");
  });

  it("cae a http:// cuando el https sintetizado falla por red/TLS", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("TLS handshake failed")) // https
      .mockResolvedValueOnce(htmlResponse("")); // http fallback
    const res = await fetchHtml("www.foo.com");
    expect(res.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://www.foo.com");
    expect(mockFetch.mock.calls[1]?.[0]).toBe("http://www.foo.com");
  });

  it("NO degrada a http un https provisto explícitamente", async () => {
    mockFetch.mockRejectedValueOnce(new Error("TLS handshake failed"));
    const res = await fetchHtml("https://foo.com");
    expect(res.error).toMatch(/^network:/);
    expect(mockFetch).toHaveBeenCalledTimes(1); // sin fallback
  });
});
