import { describe, expect, it } from "vitest";
import {
  classifyUruguayPhone,
  classifyUruguayPhones,
} from "../../src/shared/phone.js";

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
