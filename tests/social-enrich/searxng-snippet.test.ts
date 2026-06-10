import { describe, it, expect, vi } from "vitest";
import { fetchInstagramSnippetViaSearxng } from "../../src/modules/social-enrich/searxng-snippet.js";
import { pickProfileFromSnippets } from "../../src/modules/social-enrich/duckduckgo-snippet.js";

// Snippets REALES capturados en el PoC contra SearXNG (10/06/2026).
const SNIPPET_DOT = "172 followers · 32 following · 79 posts · @aberfervi: “Trabajamos para ofrecerte calidad”";
const SNIPPET_COMMA = '176 Followers, 243 Following, 151 Posts - @Alimarket on Instagram: "Ali market food"';
const SNIPPET_K = "85K followers · 2 following · 410 posts · @address.jo: “متجر”";
const SNIPPET_MISS = "Adolfo Café (@adolfocafe) • Instagram photos and videos";

function searxngResponse(results: Array<{ content?: string; title?: string }>): Response {
  return {
    ok: true,
    json: async () => ({ results }),
  } as unknown as Response;
}

describe("parseInstagramSnippet — robustez de formato (PoC SearXNG)", () => {
  it("parsea el formato con separador '·' (followers/following/posts en minúscula)", () => {
    const p = pickProfileFromSnippets([SNIPPET_DOT], "aberfervi");
    expect(p).not.toBeNull();
    expect(p!.followers_count).toBe(172);
    expect(p!.follows_count).toBe(32);
    expect(p!.media_count).toBe(79);
  });

  it("parsea el formato con comas y ' - ' (con bio)", () => {
    const p = pickProfileFromSnippets([SNIPPET_COMMA], "alimarket");
    expect(p!.followers_count).toBe(176);
    expect(p!.follows_count).toBe(243);
    expect(p!.media_count).toBe(151);
    expect(p!.biography).toContain("Ali market");
  });

  it("soporta sufijo K (85K → 85000)", () => {
    const p = pickProfileFromSnippets([SNIPPET_K], "address.jo");
    expect(p!.followers_count).toBe(85000);
  });

  it("devuelve null cuando el snippet no tiene métricas", () => {
    expect(pickProfileFromSnippets([SNIPPET_MISS], "adolfocafe")).toBeNull();
  });
});

describe("fetchInstagramSnippetViaSearxng", () => {
  it("consulta el endpoint local con site:instagram.com/<handle> y parsea results[].content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(searxngResponse([{ content: SNIPPET_DOT, title: "x" }]));
    const profile = await fetchInstagramSnippetViaSearxng("aberfervi", { throttleMs: 0, baseUrl: "http://localhost:8080", fetchImpl });
    expect(profile!.followers_count).toBe(172);
    const calledUrl = fetchImpl.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/search?q=");
    expect(decodeURIComponent(calledUrl)).toContain("site:instagram.com/aberfervi");
    expect(calledUrl).toContain("format=json");
  });

  it("devuelve null si ningún resultado trae métricas (cuenta personal)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(searxngResponse([{ content: SNIPPET_MISS, title: "Adolfo Café" }]));
    const profile = await fetchInstagramSnippetViaSearxng("adolfocafe", { throttleMs: 0, fetchImpl });
    expect(profile).toBeNull();
  });

  it("degrada con gracia (null) si SearXNG no responde / status no-ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);
    const profile = await fetchInstagramSnippetViaSearxng("x", { throttleMs: 0, fetchImpl });
    expect(profile).toBeNull();
  });

  it("degrada con gracia (null) ante error de red, sin lanzar", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchInstagramSnippetViaSearxng("x", { throttleMs: 0, fetchImpl })).resolves.toBeNull();
  });
});
