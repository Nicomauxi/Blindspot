import { describe, it, expect, vi } from "vitest";
import {
  parseInstagramSnippet,
  extractSnippets,
  isAntiBot,
  fetchInstagramSnippet,
} from "../../src/modules/social-enrich/duckduckgo-snippet.js";

describe("parseInstagramSnippet", () => {
  it("parsea followers/following/posts (K/M) + bio del formato real de DDG", () => {
    const s = "666M Followers, 646 Following, 4,083 Posts - See Instagram photos and videos from Cristiano Ronaldo (@cristiano)";
    const p = parseInstagramSnippet(s, "cristiano")!;
    expect(p.followers_count).toBe(666_000_000);
    expect(p.media_count).toBe(4083);
    expect(p.follows_count).toBe(646);
    expect(p.biography).toContain("Cristiano Ronaldo");
  });

  it("extrae la bio tras 'on Instagram:'", () => {
    const s = "104M Followers, 95 Following, 4,812 Posts - NASA (@nasa) on Instagram: \"Making the impossible, possible.\"";
    const p = parseInstagramSnippet(s, "nasa")!;
    expect(p.followers_count).toBe(104_000_000);
    expect(p.biography).toBe("Making the impossible, possible.");
  });

  it("cuenta chica de pyme (sin sufijo)", () => {
    const s = "3,200 Followers, 180 Following, 412 Posts - Panadería Godoy. Pedidos 099123456";
    const p = parseInstagramSnippet(s, "panaderiagodoy")!;
    expect(p.followers_count).toBe(3200);
    expect(p.media_count).toBe(412);
    expect(p.biography).toContain("099123456");
  });

  it("devuelve null si no hay ninguna métrica", () => {
    expect(parseInstagramSnippet("Algo sin métricas de instagram", "x")).toBeNull();
  });
});

describe("extractSnippets", () => {
  it("extrae snippets del markup html de DDG y limpia tags/entidades", () => {
    const html = `<a class="result__snippet" href="x">3,200 Followers, 180 Following, 412 Posts - Pan &amp; Caf&#x27;</a>`;
    const out = extractSnippets(html);
    expect(out[0]).toBe("3,200 Followers, 180 Following, 412 Posts - Pan & Caf'");
  });
  it("extrae del markup lite (td.result-snippet)", () => {
    const html = `<td class="result-snippet">104M Followers, 95 Following, 4,812 Posts - NASA</td>`;
    expect(extractSnippets(html)[0]).toContain("104M Followers");
  });
});

describe("isAntiBot", () => {
  it("detecta el modal de anomalía de DDG", () => {
    expect(isAntiBot('<div class="anomaly-modal__box">...')).toBe(true);
    expect(isAntiBot("<html>resultados normales</html>")).toBe(false);
  });
});

describe("fetchInstagramSnippet (degradación graciosa)", () => {
  it("devuelve el perfil cuando DDG responde con snippet", async () => {
    const fetchImpl = vi.fn(async () => ({
      text: async () => `<a class="result__snippet">3,200 Followers, 180 Following, 412 Posts - Panadería Godoy</a>`,
    })) as unknown as typeof fetch;
    const p = await fetchInstagramSnippet("panaderiagodoy", { fetchImpl });
    expect(p?.followers_count).toBe(3200);
  });

  it("degrada a null ante anti-bot (no lanza)", async () => {
    const fetchImpl = vi.fn(async () => ({
      text: async () => `<div class="anomaly-modal__box">challenge</div>`,
    })) as unknown as typeof fetch;
    const p = await fetchInstagramSnippet("x", { fetchImpl });
    expect(p).toBeNull();
  });

  it("degrada a null ante error de red (no lanza)", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const p = await fetchInstagramSnippet("x", { fetchImpl });
    expect(p).toBeNull();
  });
});
