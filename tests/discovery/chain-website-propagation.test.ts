import { describe, expect, it } from "vitest";
import {
  computeChainWebsitePropagations,
  extractRealDomain,
  type PropagationLead,
} from "../../src/modules/discovery/chain-website-propagation.js";

describe("extractRealDomain", () => {
  it("normaliza un dominio real", () => {
    expect(extractRealDomain("https://www.tiendainglesa.com.uy/sucursal")).toBe("tiendainglesa.com.uy");
    expect(extractRealDomain("http://tiendainglesa.com.uy")).toBe("tiendainglesa.com.uy");
  });
  it("descarta redes sociales y vacíos", () => {
    expect(extractRealDomain("https://www.instagram.com/lapasiva/")).toBeNull();
    expect(extractRealDomain("https://facebook.com/x")).toBeNull();
    expect(extractRealDomain(null)).toBeNull();
    expect(extractRealDomain("notaurl")).toBeNull();
  });
});

describe("computeChainWebsitePropagations", () => {
  it("propaga el dominio dominante a las fichas sin web (caso Tienda Inglesa)", () => {
    const leads: PropagationLead[] = [
      { id: "1", name: "Tienda Inglesa", website: "https://www.tiendainglesa.com.uy/" },
      { id: "2", name: "Tienda Inglesa", website: "http://www.tiendainglesa.com.uy/" },
      { id: "3", name: "Tienda Inglesa", website: null },
      { id: "4", name: "Tienda Inglesa", website: "" },
    ];
    const out = computeChainWebsitePropagations(leads);
    expect(out.map((p) => p.id).sort()).toEqual(["3", "4"]);
    expect(out[0]!.website).toBe("https://www.tiendainglesa.com.uy/");
    expect(out[0]!.via_domain).toBe("tiendainglesa.com.uy");
  });

  it("NO propaga URLs sociales por-sucursal (caso La Pasiva)", () => {
    const leads: PropagationLead[] = [
      { id: "1", name: "La Pasiva", website: "https://www.instagram.com/lapasivadegorlero/" },
      { id: "2", name: "La Pasiva", website: null },
      { id: "3", name: "La Pasiva", website: null },
    ];
    expect(computeChainWebsitePropagations(leads)).toEqual([]);
  });

  it("NO propaga si hay más de un dominio real distinto (ambigüedad)", () => {
    const leads: PropagationLead[] = [
      { id: "1", name: "El Fogon", website: "https://elfogon-pocitos.com" },
      { id: "2", name: "El Fogon", website: "https://elfogon-centro.com" },
      { id: "3", name: "El Fogon", website: null },
    ];
    expect(computeChainWebsitePropagations(leads)).toEqual([]);
  });

  it("NO propaga si el dominio aparece en una sola ficha (dato suelto)", () => {
    const leads: PropagationLead[] = [
      { id: "1", name: "Cafe Central", website: "https://cafecentral.uy" },
      { id: "2", name: "Cafe Central", website: null },
    ];
    expect(computeChainWebsitePropagations(leads)).toEqual([]);
  });

  it("ignora nombres genéricos cortos (<=5 chars normalizados)", () => {
    const leads: PropagationLead[] = [
      { id: "1", name: "Bar", website: "https://bar.com" },
      { id: "2", name: "Bar", website: "https://bar.com" },
      { id: "3", name: "Bar", website: null },
    ];
    expect(computeChainWebsitePropagations(leads)).toEqual([]);
  });
});
