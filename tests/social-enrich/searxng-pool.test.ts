import { describe, it, expect } from "vitest";
import { SearxngPool, parseSearxngUrls } from "../../src/modules/social-enrich/searxng-pool.js";

describe("parseSearxngUrls", () => {
  it("usa SEARXNG_URLS (csv) cuando está", () => {
    expect(parseSearxngUrls({ SEARXNG_URLS: "http://a:8080, http://b:8080/ " } as NodeJS.ProcessEnv))
      .toEqual(["http://a:8080", "http://b:8080"]);
  });
  it("cae a SEARXNG_URL si no hay multi", () => {
    expect(parseSearxngUrls({ SEARXNG_URL: "http://x:8080" } as NodeJS.ProcessEnv)).toEqual(["http://x:8080"]);
  });
  it("default localhost si no hay nada", () => {
    expect(parseSearxngUrls({} as NodeJS.ProcessEnv)).toEqual(["http://localhost:8080"]);
  });
});

describe("SearxngPool", () => {
  it("round-robin entre instancias disponibles", () => {
    const pool = new SearxngPool(["http://a", "http://b", "http://c"], () => 1000);
    expect(pool.next().url).toBe("http://a");
    expect(pool.next().url).toBe("http://b");
    expect(pool.next().url).toBe("http://c");
    expect(pool.next().url).toBe("http://a");
  });

  it("saltea una instancia en cooldown", () => {
    let now = 1000;
    const pool = new SearxngPool(["http://a", "http://b"], () => now);
    pool.markThrottled("http://a");
    expect(pool.availableCount()).toBe(1);
    // a en cooldown → siempre devuelve b mientras dure
    expect(pool.next().url).toBe("http://b");
    expect(pool.next().url).toBe("http://b");
    // pasado el cooldown (60s) vuelve a estar disponible
    now += 61_000;
    expect(pool.availableCount()).toBe(2);
  });

  it("si TODAS están en cooldown, devuelve la más próxima a recuperarse", () => {
    let now = 1000;
    const pool = new SearxngPool(["http://a", "http://b"], () => now);
    pool.markThrottled("http://a");
    now += 1; // a entra en cooldown un instante antes
    pool.markThrottled("http://b");
    const pick = pool.next();
    expect(pick.url).toBe("http://a"); // cooldownUntil menor
  });

  it("una sola URL = comportamiento de instancia única", () => {
    const pool = new SearxngPool(["http://solo"], () => 0);
    expect(pool.size()).toBe(1);
    expect(pool.next().url).toBe("http://solo");
    expect(pool.next().url).toBe("http://solo");
  });
});
