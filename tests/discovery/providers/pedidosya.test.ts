import { describe, it, expect, vi } from "vitest";
import {
  PedidosYaProvider,
  locationToSlug,
} from "../../../src/modules/discovery/providers/pedidosya.js";

function makeHtmlPage(
  listings: { name: string; slug: string; uuid?: string }[],
  city = "montevideo"
): string {
  const items = listings
    .map(({ name, slug, uuid }) => {
      const href = uuid
        ? `/restaurantes/${city}/${slug}-${uuid}-menu`
        : `/restaurantes/${city}/${slug}-menu`;
      return `<li><a href="${href}" aria-label="Ir al restaurante ${name}"><span>${name}</span></a></li>`;
    })
    .join("\n");
  return `<html><body><ul>${items}</ul></body></html>`;
}

function makeFetchPage(pages: string[]) {
  let call = 0;
  return vi.fn(async (_url: string): Promise<string> => {
    const html = pages[call] ?? "";
    call++;
    return html;
  });
}

describe("PedidosYaProvider — identity", () => {
  it("source === 'pedidosya'", () => {
    const provider = new PedidosYaProvider();
    expect(provider.source).toBe("pedidosya");
  });

  it("sourceConfidence === 0.7", () => {
    const provider = new PedidosYaProvider();
    expect(provider.sourceConfidence).toBe(0.7);
  });
});

describe("PedidosYaProvider.discover", () => {
  it("returns empty array when niche has no category mapping", async () => {
    const fetchPage = vi.fn();
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "other", location: "Montevideo Uruguay" });
    expect(result).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("parses listings correctly — name, listing_url, externalId from UUID", async () => {
    const uuid = "a1b2c3d4-1111-2222-3333-444455556666";
    const html = makeHtmlPage([
      { name: "La Stampa", slug: "la-stampa", uuid },
    ]);
    const fetchPage = makeFetchPage([html, ""]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toHaveLength(1);
    const candidate = result[0]!;
    expect(candidate.name).toBe("La Stampa");
    expect(candidate.external_id).toBe(uuid);
    expect((candidate.raw as { listing_url: string }).listing_url).toBe(
      `https://www.pedidosya.com.uy/restaurantes/montevideo/la-stampa-${uuid}-menu`
    );
    expect((candidate.raw as { expedition_type: string }).expedition_type).toBe("delivery");
    expect(candidate.source).toBe("pedidosya");
    expect(candidate.source_confidence).toBe(0.7);
  });

  it("external_id uses slug fallback when no UUID in href", async () => {
    const html = makeHtmlPage([{ name: "Starbucks La Española", slug: "starbucks-la-espanola" }]);
    const fetchPage = makeFetchPage([html, ""]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result[0]?.external_id).toBe("starbucks-la-espanola");
  });

  it("returns empty array when page is empty", async () => {
    const fetchPage = makeFetchPage(["<html><body></body></html>"]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toEqual([]);
  });

  it("respects maxResults limit", async () => {
    const html = makeHtmlPage([
      { name: "A", slug: "a" },
      { name: "B", slug: "b" },
      { name: "C", slug: "c" },
    ]);
    const fetchPage = makeFetchPage([html]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({
      niche: "restaurant",
      location: "Montevideo Uruguay",
      maxResults: 2,
    });
    expect(result).toHaveLength(2);
  });

  it("stops at MAX_PAGES (5) even if results keep coming", async () => {
    const page = makeHtmlPage([{ name: "N", slug: "n" }]);
    const fetchPage = vi.fn().mockResolvedValue(page);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(result).toHaveLength(5);
  });

  it("paginates until empty page", async () => {
    const page1 = makeHtmlPage([{ name: "A", slug: "a" }]);
    const page2 = makeHtmlPage([{ name: "B", slug: "b" }]);
    const fetchPage = makeFetchPage([page1, page2, ""]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("website and email are always null", async () => {
    const html = makeHtmlPage([{ name: "Test", slug: "test" }]);
    const fetchPage = makeFetchPage([html, ""]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result[0]?.website).toBeNull();
    expect(result[0]?.email).toBeNull();
    expect(result[0]?.address).toBeNull();
    expect(result[0]?.phone).toBeNull();
  });

  it("aria-label without expected prefix → uses full aria-label as name fallback", async () => {
    const html = `<html><body><ul>
      <li><a href="/restaurantes/montevideo/fit-gym-menu" aria-label="Ir al gimnasio Fit Gym"><span>Fit Gym</span></a></li>
    </ul></body></html>`;
    const fetchPage = makeFetchPage([html, ""]);
    const provider = new PedidosYaProvider({ fetchPage });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result[0]?.name).toBe("Ir al gimnasio Fit Gym");
  });

  it("builds correct URL with city slug", async () => {
    const fetchPage = makeFetchPage(["<html></html>"]);
    const provider = new PedidosYaProvider({ fetchPage });
    await provider.discover({ niche: "restaurant", location: "Salto Uruguay" });
    const calledUrl = (fetchPage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("https://www.pedidosya.com.uy/restaurantes/salto");
  });
});

describe("locationToSlug", () => {
  it("strips 'Uruguay' before slugifying", () => {
    expect(locationToSlug("Montevideo Uruguay")).toBe("montevideo");
  });

  it("strips diacritics — 'Paysandú' → 'paysandu'", () => {
    expect(locationToSlug("Paysandú")).toBe("paysandu");
  });

  it("strips diacritics — 'Colonia del Sacramento Uruguay'", () => {
    expect(locationToSlug("Colonia del Sacramento Uruguay")).toBe("colonia-del-sacramento");
  });

  it("handles multiple spaces and leading/trailing whitespace", () => {
    expect(locationToSlug("  Río Negro  ")).toBe("rio-negro");
  });

  it("strips 'Uruguay' case-insensitively", () => {
    expect(locationToSlug("Salto URUGUAY")).toBe("salto");
  });
});
