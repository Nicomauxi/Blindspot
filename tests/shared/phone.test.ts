import { describe, expect, it } from "vitest";
import {
  canonicalUruguayPhoneKey,
  classifyUruguayPhone,
  classifyUruguayPhones,
} from "../../src/shared/phone.js";

describe("canonicalUruguayPhoneKey (IT-01/IT-06)", () => {
  it("colapsa las tres grafías del mismo móvil a UNA clave", () => {
    const keys = ["+598 99 123 456", "099123456", "99123456"].map(canonicalUruguayPhoneKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("99123456");
  });

  it("canoniza fijos del interior (prefijo 3/4) — antes se descartaban (IT-06)", () => {
    expect(canonicalUruguayPhoneKey("+598 4322 1234")).toBe("43221234");
    expect(canonicalUruguayPhoneKey("043221234")).toBe("43221234");
    expect(canonicalUruguayPhoneKey("43221234")).toBe("43221234");
  });

  it("null para entradas no reconocibles", () => {
    expect(canonicalUruguayPhoneKey(null)).toBeNull();
    expect(canonicalUruguayPhoneKey("")).toBeNull();
    expect(canonicalUruguayPhoneKey("123")).toBeNull();
  });
});

describe("classifyUruguayPhone", () => {
  it("classifies mobile numbers with country code", () => {
    expect(classifyUruguayPhone("+59898000000")).toMatchObject({
      normalized: "+59898000000",
      type: "mobile",
      region: null,
    });
  });

  it("classifies Montevideo landlines", () => {
    expect(classifyUruguayPhone("24087679")).toMatchObject({
      normalized: "+59824087679",
      type: "landline",
      region: "montevideo",
    });
  });

  it("classifies interior landlines", () => {
    expect(classifyUruguayPhone("047771234")).toMatchObject({
      normalized: "+59847771234",
      type: "landline",
      region: "interior",
    });
  });

  it("returns unknown for malformed values", () => {
    expect(classifyUruguayPhone("1234")).toMatchObject({
      normalized: null,
      type: "unknown",
      region: null,
    });
  });
});

describe("classifyUruguayPhones", () => {
  it("deduplicates repeated normalized numbers", () => {
    const results = classifyUruguayPhones([
      "098000000",
      "+59898000000",
      "24087679",
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((phone) => phone.normalized)).toEqual([
      "+59898000000",
      "+59824087679",
    ]);
  });
});
