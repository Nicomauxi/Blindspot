import { describe, it, expect, beforeEach } from "vitest";
import { getScoringConfig, parseConfig, resetScoringConfigCache } from "../../src/modules/scoring/config.js";

beforeEach(() => {
  resetScoringConfigCache();
});

const VALID_YAML = `
version: 1
business_quality:
  rules:
    - name: rating_excellent
      condition: { field: rating, op: gte, value: 4.5 }
      weight: 25
    - name: rating_good
      condition: { field: rating, op: between, value: [4.0, 4.5] }
      weight: 15
digital_gap:
  rules:
    - name: no_website
      condition: { tag: no-website }
      weight: 35
mutual_exclusions:
  business_quality:
    - [rating_excellent, rating_good]
  digital_gap: []
cap: 100
prospect_formula: "business_quality * digital_gap / 100"
`;

describe("parseConfig", () => {
  it("parses valid YAML and returns a ScoringConfig", () => {
    const config = parseConfig(VALID_YAML);
    expect(config.version).toBe(1);
    expect(config.business_quality.rules).toHaveLength(2);
    expect(config.digital_gap.rules).toHaveLength(1);
    expect(config.cap).toBe(100);
    expect(config.prospect_formula).toBe("business_quality * digital_gap / 100");
  });

  it("throws when version is missing", () => {
    const yaml = VALID_YAML.replace("version: 1\n", "");
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("throws when a rule has non-numeric weight", () => {
    const yaml = `
version: 1
business_quality:
  rules:
    - name: bad_rule
      condition: { tag: no-website }
      weight: "not-a-number"
digital_gap:
  rules: []
mutual_exclusions:
  business_quality: []
  digital_gap: []
cap: 100
prospect_formula: "business_quality * digital_gap / 100"
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("throws when prospect_formula is not the expected literal", () => {
    const yaml = VALID_YAML.replace(
      '"business_quality * digital_gap / 100"',
      '"wrong_formula"'
    );
    expect(() => parseConfig(yaml)).toThrow(/prospect_formula|Invalid literal/i);
  });

  it("throws when a dimension has duplicate rule names", () => {
    const yaml = `
version: 1
business_quality:
  rules:
    - name: dup_rule
      condition: { tag: no-website }
      weight: 10
    - name: dup_rule
      condition: { tag: ssl-missing }
      weight: 5
digital_gap:
  rules: []
mutual_exclusions:
  business_quality: []
  digital_gap: []
cap: 100
prospect_formula: "business_quality * digital_gap / 100"
`;
    expect(() => parseConfig(yaml)).toThrow(/Duplicate rule name/i);
  });
});

describe("getScoringConfig", () => {
  it("loads the real scoring.yaml and returns valid config", () => {
    const config = getScoringConfig();
    expect(config.version).toBe(1);
    expect(config.business_quality.rules.length).toBeGreaterThan(0);
    expect(config.digital_gap.rules.length).toBeGreaterThan(0);
    expect(config.digital_gap.rules).toContainEqual({
      name: "web_outdated",
      condition: { tag: "web-outdated" },
      weight: 8,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "fb_confirmed",
      condition: { tag: "fb-confirmed" },
      weight: 20,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "ig_confirmed",
      condition: { tag: "ig-confirmed" },
      weight: 20,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "whatsapp_confirmed",
      condition: { tag: "whatsapp-confirmed" },
      weight: 3,
    });
    expect(config.mutual_exclusions.digital_gap).toContainEqual([
      "whatsapp_confirmed",
      "whatsapp_derived",
      "whatsapp_missing",
    ]);
    expect(config.prospect_formula).toBe("business_quality * digital_gap / 100");
  });

  it("singleton: two calls return the same object reference", () => {
    const first = getScoringConfig();
    const second = getScoringConfig();
    expect(second).toBe(first);
  });
});
