import { afterEach, describe, expect, it } from "vitest";
import { USER_AGENT, getFetchTimeoutMs, getFetchRetries } from "../../src/modules/enrichment/http.js";

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
