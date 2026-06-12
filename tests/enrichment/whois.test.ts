import { describe, it, expect, vi, beforeEach } from "vitest";

const whoisDomainMock = vi.fn();
vi.mock("whoiser", () => ({ whoisDomain: (...args: unknown[]) => whoisDomainMock(...args) }));

import { whoisLookup } from "../../src/modules/enrichment/whois.js";

describe("whoisLookup — F4.1 skip .uy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("salta la consulta de red para dominios .uy y .com.uy", async () => {
    for (const domain of ["foo.uy", "https://www.bar.com.uy/contacto", "BAZ.COM.UY"]) {
      const res = await whoisLookup(domain);
      expect(res.error).toBe("uy-whois-unsupported");
      expect(res.age_years).toBeNull();
    }
    expect(whoisDomainMock).not.toHaveBeenCalled();
  });

  it("sí consulta para dominios no-.uy", async () => {
    whoisDomainMock.mockResolvedValueOnce({});
    await whoisLookup("example.com");
    expect(whoisDomainMock).toHaveBeenCalledTimes(1);
  });

  it("rechaza dominio inválido sin consultar", async () => {
    const res = await whoisLookup("noesundominio");
    expect(res.error).toBe("invalid-domain");
    expect(whoisDomainMock).not.toHaveBeenCalled();
  });
});
