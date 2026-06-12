import { describe, expect, it } from "vitest";
import { findGenericSharedPhones, isJunkPhone } from "../../src/modules/discovery/phone-quality.js";
import { normalizeCandidate } from "../../src/modules/discovery/candidate-normalizer.js";
import { JUNK_PHONE_CASES, SHARED_PHONE_THRESHOLD } from "./fixtures/junk-phones.js";
import type { DiscoveryCandidate } from "../../src/shared/types.js";

describe("isJunkPhone (F5.3)", () => {
  for (const c of JUNK_PHONE_CASES.filter((c) => c.reason !== "compartido por 52 leads DEI (gestor)")) {
    it(`${c.phone} → ${c.isJunk} (${c.reason})`, () => {
      expect(isJunkPhone(c.phone)).toBe(c.isJunk);
    });
  }

  it("null/vacío no es junk (simplemente no hay phone)", () => {
    expect(isJunkPhone(null)).toBe(false);
    expect(isJunkPhone("")).toBe(false);
  });
});

describe("findGenericSharedPhones (F5.3)", () => {
  it("detecta el phone compartido por más del umbral", () => {
    const phones = [
      ...Array.from({ length: SHARED_PHONE_THRESHOLD + 1 }, () => "24070000"),
      "24013030",
      "+598 99 111 222",
    ];
    expect(findGenericSharedPhones(phones, SHARED_PHONE_THRESHOLD)).toEqual(new Set(["24070000"]));
  });

  it("no marca phones dentro del umbral", () => {
    const phones = Array.from({ length: SHARED_PHONE_THRESHOLD }, () => "24013030");
    expect(findGenericSharedPhones(phones, SHARED_PHONE_THRESHOLD).size).toBe(0);
  });
});

describe("normalizeCandidate limpia phones basura (F5.3)", () => {
  const base: DiscoveryCandidate = {
    source: "dei",
    external_id: "x",
    source_confidence: 1,
    name: "Negocio",
    address: null,
    phone: "0",
    email: null,
    website: null,
    latitude: null,
    longitude: null,
    niche: "other",
    raw: {},
  };

  it("phone '0' → null", () => {
    expect(normalizeCandidate(base, []).phone).toBeNull();
  });

  it("phone válido se conserva", () => {
    const c = { ...base, phone: "+598 99 111 222" };
    expect(normalizeCandidate(c, []).phone).toBe("+598 99 111 222");
  });
});
