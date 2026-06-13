import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickRealWebsite, pickReviewMeta, unifiedLeadLookup } from "../../src/modules/social-enrich/serper-provider.js";

const OLD = process.env["SERPER_API_KEY"];
beforeEach(() => { process.env["SERPER_API_KEY"] = "test-key"; });
afterEach(() => {
  if (OLD === undefined) delete process.env["SERPER_API_KEY"]; else process.env["SERPER_API_KEY"] = OLD;
  vi.restoreAllMocks();
});

// Respuesta real (validada en vivo) para "Floreal Restaurante Punta del Este".
const FLOREAL = {
  organic: [
    { link: "https://www.instagram.com/florealrestaurante/?hl=es", title: "Floreal (@florealrestaurante)", snippet: "Floreal restaurante" },
    { link: "https://floreal.com.uy/carta-del-restaurante/", title: "Carta", snippet: "menu" },
    { link: "https://floreal.com.uy/", title: "Floreal Restaurante", snippet: "Punta del Este" },
    { link: "https://www.tripadvisor.es/Restaurant_Review-Floreal.html", title: "Floreal - Tripadvisor", snippet: "rev", rating: 4.3, ratingCount: 288 },
  ],
};

function mockFetch(body: unknown): typeof fetch {
  return vi.fn(async () => ({ status: 200, ok: true, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
}

describe("pickRealWebsite", () => {
  it("elige el dominio propio, salteando social y agregadores", () => {
    expect(pickRealWebsite(FLOREAL.organic)).toBe("https://floreal.com.uy/");
  });
  it("null si solo hay social/agregadores", () => {
    expect(pickRealWebsite([
      { link: "https://instagram.com/x" }, { link: "https://www.tripadvisor.com/y" }, { link: "https://facebook.com/z" },
    ])).toBeNull();
  });
});

describe("pickReviewMeta", () => {
  it("toma el resultado con más ratingCount", () => {
    expect(pickReviewMeta([
      { link: "a", rating: 4.0, ratingCount: 50 },
      { link: "b", rating: 4.3, ratingCount: 288 },
      { link: "c" },
    ])).toEqual({ rating: 4.3, review_count: 288 });
  });
  it("null si ningún resultado tiene rating", () => {
    expect(pickReviewMeta([{ link: "a", snippet: "x" }])).toBeNull();
  });
});

describe("unifiedLeadLookup (1 query → website + IG + reviews)", () => {
  it("extrae website, IG y reviews-meta de una sola query", async () => {
    const res = await unifiedLeadLookup(
      { name: "Floreal Restaurante", address: "Punta del Este, Maldonado" },
      { fetchImpl: mockFetch(FLOREAL) }
    );
    expect(res.website).toBe("https://floreal.com.uy/");
    expect(res.instagram.best_url).toContain("instagram.com/florealrestaurante");
    expect(res.review_meta).toEqual({ rating: 4.3, review_count: 288 });
  });

  it("guard de cuenta global homónima descarta el IG pero conserva website", async () => {
    const res = await unifiedLeadLookup(
      { name: "Olivia", address: "Montevideo" },
      { fetchImpl: mockFetch({ organic: [
        { link: "https://oliviacafe.uy/", title: "Olivia Cafe", snippet: "Montevideo" },
        { link: "https://www.instagram.com/oliviarodrigo/", title: "Olivia Rodrigo (@oliviarodrigo)", snippet: "40.6M followers · 0 following · 200 posts · @oliviarodrigo" },
      ] }) }
    );
    expect(res.website).toBe("https://oliviacafe.uy/");
    expect(res.instagram.best_url).toBeNull(); // homónima global rechazada
  });
});
