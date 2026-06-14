import { describe, expect, it } from "vitest";
import { classifyVertical, verticalTag, isCommercialVertical } from "../../src/modules/discovery/vertical.js";

describe("classifyVertical (F1.4)", () => {
  it("CIIU 10-33 → industrial", () => {
    expect(classifyVertical("25921")).toBe("industrial"); // tornería mecánica
    expect(classifyVertical("1010")).toBe("industrial"); // alimentos
    expect(classifyVertical("33")).toBe("industrial");
    expect(classifyVertical("10")).toBe("industrial");
  });

  it("CIIU 45-47 / 55-56 / 95-96 → comercio-local", () => {
    expect(classifyVertical("47111")).toBe("comercio-local"); // minorista
    expect(classifyVertical("4520")).toBe("comercio-local"); // vehículos
    expect(classifyVertical("5610")).toBe("comercio-local"); // restaurante
    expect(classifyVertical("5510")).toBe("comercio-local"); // hotel
    expect(classifyVertical("9602")).toBe("comercio-local"); // peluquería
    expect(classifyVertical("9511")).toBe("comercio-local"); // reparación
  });

  it("otras divisiones → otro (B2B/no comercio local)", () => {
    expect(classifyVertical("0150")).toBe("otro"); // agro (div 1)
    expect(classifyVertical("4100")).toBe("otro"); // construcción (div 41)
    expect(classifyVertical("6920")).toBe("otro"); // contabilidad (div 69)
    expect(classifyVertical("8510")).toBe("otro"); // educación
  });

  it("sin código o ilegible → otro", () => {
    expect(classifyVertical(null)).toBe("otro");
    expect(classifyVertical("")).toBe("otro");
    expect(classifyVertical("S/D")).toBe("otro");
    expect(classifyVertical("7")).toBe("otro");
  });

  it("helpers", () => {
    expect(verticalTag("industrial")).toBe("vertical-industrial");
    expect(verticalTag("comercio-local")).toBe("vertical-comercio-local");
    expect(isCommercialVertical("comercio-local")).toBe(true);
    expect(isCommercialVertical("industrial")).toBe(false);
    expect(isCommercialVertical("otro")).toBe(false);
  });
});
