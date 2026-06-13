import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverEnrichViaSerper, serperConfigured, serperSearch } from "../../src/modules/social-enrich/serper-provider.js";

const OLD = process.env["SERPER_API_KEY"];
beforeEach(() => {
  process.env["SERPER_API_KEY"] = "test-key";
});
afterEach(() => {
  if (OLD === undefined) delete process.env["SERPER_API_KEY"];
  else process.env["SERPER_API_KEY"] = OLD;
});

// Respuesta realista de Serper para `site:instagram.com "La Pasiva" montevideo`.
const SERPER_RESPONSE = {
  organic: [
    { link: "https://www.instagram.com/lapasiva.mvd/", title: "La Pasiva (@lapasiva.mvd) • Instagram photos and videos", snippet: "Plaza Italia: 2614 9000 · En La Pasiva tenemos promos" },
    { link: "https://www.instagram.com/lapasiva.mvd/reels/", title: "La Pasiva (@lapasiva.mvd) • Instagram", snippet: "15K followers · 714 following · 303 posts · @lapasiva.mvd: bio" },
    { link: "https://www.instagram.com/reel/DWkTp1IjoYF/", title: "post suelto", snippet: "2875 likes" },
  ],
};

function mockFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
}

describe("serperConfigured", () => {
  it("true con key, false sin key", () => {
    expect(serperConfigured()).toBe(true);
    delete process.env["SERPER_API_KEY"];
    expect(serperConfigured()).toBe(false);
  });
});

describe("serperSearch", () => {
  it("mapea organic → {url,title,content}", async () => {
    const res = await serperSearch("q", { fetchImpl: mockFetch(SERPER_RESPONSE) });
    expect(res[0]).toEqual({
      url: "https://www.instagram.com/lapasiva.mvd/",
      title: "La Pasiva (@lapasiva.mvd) • Instagram photos and videos",
      content: "Plaza Italia: 2614 9000 · En La Pasiva tenemos promos",
    });
  });
  it("sin key → [] (no llama a la red)", async () => {
    delete process.env["SERPER_API_KEY"];
    const fetchImpl = mockFetch(SERPER_RESPONSE);
    expect(await serperSearch("q", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("discoverEnrichViaSerper (1 query → URL + métricas)", () => {
  it("descubre el perfil y extrae followers del MISMO set de resultados", async () => {
    const res = await discoverEnrichViaSerper(
      { name: "La Pasiva", address: "Montevideo" },
      { fetchImpl: mockFetch(SERPER_RESPONSE) }
    );
    expect(res.instagram.best_url).toBe("https://www.instagram.com/lapasiva.mvd/");
    expect(res.igUsername).toBe("lapasiva.mvd");
    expect(res.metrics?.followers_count).toBe(15000);
    expect(res.metrics?.media_count).toBe(303);
  });

  it("post RECIENTE → conserva timestamp (liveness activa confiable)", async () => {
    const recent = "30 likes, 4 comments - lapasiva.mvd on June 1, 2026: \"abrimos\"";
    const res = await discoverEnrichViaSerper(
      { name: "La Pasiva", address: "Montevideo" },
      {
        fetchImpl: mockFetch({ organic: [{ link: "https://www.instagram.com/lapasiva.mvd/", title: "La Pasiva (@lapasiva.mvd)", snippet: recent }] }),
        nowMs: Date.parse("2026-06-13T00:00:00Z"),
      }
    );
    expect(res.metrics?.recent_media[0]?.timestamp).toBe("2026-06-01T03:00:00.000Z");
  });

  it("post VIEJO → descarta timestamp (evita falso 'abandoned'), conserva engagement", async () => {
    const old = "30 likes, 4 comments - lapasiva.mvd on January 1, 2024: \"viejo\"";
    const res = await discoverEnrichViaSerper(
      { name: "La Pasiva", address: "Montevideo" },
      {
        fetchImpl: mockFetch({ organic: [{ link: "https://www.instagram.com/lapasiva.mvd/", title: "La Pasiva (@lapasiva.mvd)", snippet: old }] }),
        nowMs: Date.parse("2026-06-13T00:00:00Z"),
      }
    );
    expect(res.metrics?.recent_media[0]?.timestamp).toBeNull();
    expect(res.metrics?.recent_media[0]?.like_count).toBe(30); // engagement se conserva
  });

  it("perfil sin snippet de followers → metrics null pero URL presente", async () => {
    const res = await discoverEnrichViaSerper(
      { name: "La Pasiva", address: "Montevideo" },
      { fetchImpl: mockFetch({ organic: [{ link: "https://www.instagram.com/lapasiva.mvd/", title: "La Pasiva (@lapasiva.mvd)", snippet: "solo bio sin metricas" }] }) }
    );
    expect(res.instagram.best_url).toBe("https://www.instagram.com/lapasiva.mvd/");
    expect(res.metrics).toBeNull();
  });
});
