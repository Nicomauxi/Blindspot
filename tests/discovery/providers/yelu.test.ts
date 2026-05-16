import { describe, it, expect, vi } from "vitest";
import { YeluProvider, locationToSlug } from "../../../src/modules/discovery/providers/yelu.js";

function makeHtmlPage(
  listings: { cmpid: string; name: string; address: string; phone: string }[]
): string {
  const items = listings
    .map(
      ({ cmpid, name, address, phone }) => `
    <div class="company" data-cmpid="${cmpid}">
      <h3><a href="/company/${cmpid}/slug">${name}</a></h3>
      <div class="address">${address}</div>
      <div class="s"><i class="fa-phone"></i><span>${phone}</span></div>
    </div>`
    )
    .join("\n");
  return `<html><body><div class="companies">${items}</div></body></html>`;
}

function makeFetch(pages: string[], status = 200) {
  let call = 0;
  return vi.fn(async (_url: string) => {
    const html = pages[call] ?? "";
    call++;
    return {
      ok: status === 200,
      status,
      text: async () => html,
    };
  });
}

describe("YeluProvider — identity", () => {
  it("source === 'yelu'", () => {
    const provider = new YeluProvider();
    expect(provider.source).toBe("yelu");
  });

  it("sourceConfidence === 0.65", () => {
    const provider = new YeluProvider();
    expect(provider.sourceConfidence).toBe(0.65);
  });
});

describe("YeluProvider.discover", () => {
  it("returns empty array when niche has no category mapping", async () => {
    const fetch = vi.fn();
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "other", location: "Montevideo Uruguay" });
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns empty array when first page fetch fails", async () => {
    const fetch = makeFetch([], 500);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toEqual([]);
  });

  it("parses listings from first page", async () => {
    const html = makeHtmlPage([
      { cmpid: "123", name: "El Parrillero", address: "Av 18 de Julio 123", phone: "098123456" },
      { cmpid: "456", name: "La Trattoria", address: "Bvar España 456", phone: "094654321" },
    ]);
    const fetch = makeFetch([html, ""]);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("El Parrillero");
    expect(result[0]?.address).toBe("Av 18 de Julio 123");
    expect(result[0]?.phone).toBe("098123456");
    expect(result[1]?.name).toBe("La Trattoria");
  });

  it("paginates until empty page", async () => {
    const page1 = makeHtmlPage([
      { cmpid: "1", name: "A", address: "Addr A", phone: "09111" },
    ]);
    const page2 = makeHtmlPage([
      { cmpid: "2", name: "B", address: "Addr B", phone: "09222" },
    ]);
    const fetch = makeFetch([page1, page2, ""]);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "gym", location: "Montevideo Uruguay" });
    expect(result).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("respects maxResults limit", async () => {
    const page1 = makeHtmlPage([
      { cmpid: "1", name: "A", address: "X", phone: "1" },
      { cmpid: "2", name: "B", address: "Y", phone: "2" },
      { cmpid: "3", name: "C", address: "Z", phone: "3" },
    ]);
    const fetch = makeFetch([page1]);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({
      niche: "restaurant",
      location: "Montevideo Uruguay",
      maxResults: 2,
    });
    expect(result).toHaveLength(2);
  });

  it("returns website: null and email: null for all candidates", async () => {
    const html = makeHtmlPage([
      { cmpid: "99", name: "Test", address: "Calle 1", phone: "099000" },
    ]);
    const fetch = makeFetch([html, ""]);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "pharmacy", location: "Montevideo Uruguay" });
    expect(result[0]?.website).toBeNull();
    expect(result[0]?.email).toBeNull();
  });

  it("maps cmpid as external_id", async () => {
    const html = makeHtmlPage([{ cmpid: "777", name: "Test", address: "Av 1", phone: "09700" }]);
    const fetch = makeFetch([html, ""]);
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "dentist", location: "Montevideo Uruguay" });
    expect(result[0]?.external_id).toBe("777");
    expect(result[0]?.source).toBe("yelu");
  });

  it("stops at MAX_PAGES even if results keep coming", async () => {
    const page = makeHtmlPage([{ cmpid: "x", name: "N", address: "A", phone: "P" }]);
    // Always return a page with one result — should stop at MAX_PAGES (20)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => page,
    });
    const provider = new YeluProvider({ fetch });
    const result = await provider.discover({ niche: "restaurant", location: "Montevideo Uruguay" });
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(result).toHaveLength(20);
  });

  it("converts location to city slug — 'Colonia del Sacramento Uruguay'", async () => {
    const fetch = makeFetch(["<html></html>"]);
    const provider = new YeluProvider({ fetch });
    await provider.discover({ niche: "restaurant", location: "Colonia del Sacramento Uruguay" });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("city:colonia-del-sacramento");
  });

  it("converts location to city slug — 'Minas Lavalleja Uruguay'", async () => {
    const fetch = makeFetch(["<html></html>"]);
    const provider = new YeluProvider({ fetch });
    await provider.discover({ niche: "restaurant", location: "Minas Lavalleja Uruguay" });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("city:minas-lavalleja");
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

  it("strips diacritics — 'Minas Lavalleja Uruguay'", () => {
    expect(locationToSlug("Minas Lavalleja Uruguay")).toBe("minas-lavalleja");
  });
});
