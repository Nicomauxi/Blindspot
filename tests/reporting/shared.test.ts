import { describe, it, expect } from "vitest";
import {
  googleMapsUrl,
  slugify,
  prospectColor,
  formatTagsForDisplay,
  summarizeFootprint,
  parseScoreBreakdown,
  sortLeadsForReport,
  bucketByProspect,
} from "../../src/modules/reporting/shared.js";
import type { DigitalFootprintEnriched } from "../../src/shared/types.js";
import { fullScored, fbOnly, nullScore } from "./fixtures/leads.js";

describe("googleMapsUrl", () => {
  it("builds the correct URL for a place_id", () => {
    expect(googleMapsUrl("ChIJabcdef123")).toBe(
      "https://www.google.com/maps/place/?q=place_id:ChIJabcdef123"
    );
  });
});

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Peluqueria Central")).toBe("peluqueria-central");
  });
  it("removes tildes (á é í ó ú)", () => {
    expect(slugify("Café León")).toBe("cafe-leon");
  });
  it("handles ñ → n", () => {
    expect(slugify("Ñoño España")).toBe("nono-espana");
  });
  it("removes ampersand and special chars", () => {
    expect(slugify("Foo & Bar!")).toBe("foo-bar");
  });
  it("collapses multiple hyphens", () => {
    expect(slugify("A  B---C")).toBe("a-b-c");
  });
  it("returns 'lead' for empty or whitespace input", () => {
    expect(slugify("")).toBe("lead");
    expect(slugify("   ")).toBe("lead");
  });
});

describe("prospectColor", () => {
  it("null → red", () => expect(prospectColor(null)).toBe("red"));
  it("0 → red", () => expect(prospectColor(0)).toBe("red"));
  it("29 → red", () => expect(prospectColor(29)).toBe("red"));
  it("30 → yellow", () => expect(prospectColor(30)).toBe("yellow"));
  it("69 → yellow", () => expect(prospectColor(69)).toBe("yellow"));
  it("70 → green", () => expect(prospectColor(70)).toBe("green"));
  it("100 → green", () => expect(prospectColor(100)).toBe("green"));
});

describe("formatTagsForDisplay", () => {
  it("removes profile:* tags", () => {
    expect(formatTagsForDisplay(["profile:a", "no-website"])).toEqual(["no-website"]);
  });
  it("respects optional limit", () => {
    expect(
      formatTagsForDisplay(["no-website", "ssl-missing", "whatsapp-missing"], 2)
    ).toEqual(["no-website", "ssl-missing"]);
  });
  it("returns empty array when all tags are profile:*", () => {
    expect(formatTagsForDisplay(["profile:a", "profile:b"])).toEqual([]);
  });
  it("handles empty tags array", () => {
    expect(formatTagsForDisplay([])).toEqual([]);
  });
});

describe("summarizeFootprint", () => {
  it("null → not enriched message", () => {
    expect(summarizeFootprint(null)).toBe("Sin datos de enriquecimiento.");
  });
  it("skipped no-website → no website message", () => {
    expect(
      summarizeFootprint({ skipped: true, reason: "no-website", fetched_at: "x" })
    ).toBe("Sin website detectado.");
  });
  it("skipped social-only → social only message", () => {
    expect(
      summarizeFootprint({ skipped: true, reason: "social-only", fetched_at: "x" })
    ).toBe("Solo presencia en redes sociales.");
  });
  it("enriched with fetch_error → error message", () => {
    const fp: DigitalFootprintEnriched = { fetched_at: "x", fetch_error: "ECONNREFUSED" };
    expect(summarizeFootprint(fp)).toContain("Error");
  });
  it("enriched with stack + whois → includes stack name and domain age", () => {
    const fp: DigitalFootprintEnriched = {
      fetched_at: "x",
      stack: { name: "WordPress", version: "4.9", confidence: "high" },
      pixels: {
        meta_pixel: { present: false, id: null },
        ga4: { present: false, id: null },
        ga_universal: { present: false, id: null },
        gtm: { present: false, id: null },
      },
      whois: {
        fetched_at: "x",
        created_at: "x",
        registrar: "r",
        expires_at: null,
        age_years: 7,
      },
    };
    const result = summarizeFootprint(fp);
    expect(result).toContain("WordPress");
    expect(result).toContain("4.9");
    expect(result).toContain("7");
  });
});

describe("parseScoreBreakdown", () => {
  it("returns null for null input", () => {
    expect(parseScoreBreakdown(null)).toBeNull();
  });
  it("returns null for garbage input", () => {
    expect(parseScoreBreakdown({ invalid: "structure", foo: 42 })).toBeNull();
  });
  it("parses a valid breakdown from fullScored fixture", () => {
    const result = parseScoreBreakdown(fullScored.score_breakdown);
    expect(result).not.toBeNull();
    expect(result?.business_quality.total).toBe(50);
    expect(result?.digital_gap.rules).toHaveLength(4);
    expect(result?.prospect.total).toBe(27);
  });
  it("rejects breakdown missing required fields", () => {
    expect(parseScoreBreakdown({ computed_at: "x", config_version: 1 })).toBeNull();
  });
});

describe("sortLeadsForReport", () => {
  it("sorts DESC by prospect_score", () => {
    const leads = [fbOnly, fullScored];
    const sorted = sortLeadsForReport(leads);
    expect(sorted[0]?.prospect_score).toBe(27);
    expect(sorted[1]?.prospect_score).toBe(0);
  });
  it("places null scores last regardless", () => {
    const leads = [nullScore, fullScored, fbOnly];
    const sorted = sortLeadsForReport(leads);
    expect(sorted[0]?.prospect_score).toBe(27);
    expect(sorted[sorted.length - 1]?.prospect_score).toBeNull();
  });
  it("tiebreaks alphabetically by name ASC", () => {
    const a = { ...fbOnly, place_id: "a", name: "Zzz Shop", prospect_score: 0 };
    const b = { ...fbOnly, place_id: "b", name: "Aaa Shop", prospect_score: 0 };
    const sorted = sortLeadsForReport([a, b]);
    expect(sorted[0]?.name).toBe("Aaa Shop");
  });
  it("does not mutate the input array", () => {
    const input = [fullScored, nullScore];
    const sorted = sortLeadsForReport(input);
    expect(sorted).not.toBe(input);
    expect(input[0]).toBe(fullScored);
  });
});

describe("bucketByProspect", () => {
  it("always returns 5 buckets for empty input", () => {
    expect(bucketByProspect([])).toHaveLength(5);
  });
  it("render order: 70-100, 50-69, 30-49, 0-29, no-score", () => {
    const buckets = bucketByProspect([]);
    expect(buckets.map((b) => b.range)).toEqual([
      "70-100",
      "50-69",
      "30-49",
      "0-29",
      "no-score",
    ]);
  });
  it("counts correctly for mixed leads", () => {
    const leads = [fullScored, fbOnly, nullScore]; // 27, 0, null
    const buckets = bucketByProspect(leads);
    const b0_29 = buckets.find((b) => b.range === "0-29");
    const noScore = buckets.find((b) => b.range === "no-score");
    expect(b0_29?.count).toBe(2); // 27 and 0 both in 0-29
    expect(noScore?.count).toBe(1);
  });
  it("counts 70-100 bucket correctly", () => {
    const high = { ...fullScored, prospect_score: 75 };
    const buckets = bucketByProspect([high]);
    expect(buckets.find((b) => b.range === "70-100")?.count).toBe(1);
  });
});
