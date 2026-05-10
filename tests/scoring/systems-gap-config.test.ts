import { describe, expect, it, beforeEach } from "vitest";
import {
  getSystemsGapConfig,
  parseSystemsGapConfig,
  resetSystemsGapConfigCache,
} from "../../src/modules/scoring/systems-gap-config.js";

beforeEach(() => {
  resetSystemsGapConfigCache();
});

const VALID_YAML = `
version: 1
enabled: true
rules:
  hairdresser:
    - name: booking_system_missing
      weight: 15
      platforms: [booksy.com]
    - name: whatsapp_business_missing
      weight: 10
      requires: [booking_system_missing]
  all:
    - name: no_booking_any
      weight: 10
      applies_to: [hairdresser, gym]
      requires_none_of: [booking_system_missing, class_booking_missing]
`;

describe("parseSystemsGapConfig", () => {
  it("parses valid systems-gap YAML", () => {
    const config = parseSystemsGapConfig(VALID_YAML);
    expect(config.version).toBe(1);
    expect(config.enabled).toBe(true);
    expect(config.rules.hairdresser).toHaveLength(2);
    expect(config.rules.all?.[0]?.applies_to).toEqual(["hairdresser", "gym"]);
  });

  it("rejects duplicate rule names within a niche", () => {
    const yaml = VALID_YAML.replace("whatsapp_business_missing", "booking_system_missing");
    expect(() => parseSystemsGapConfig(yaml)).toThrow(/Duplicate systems_gap rule/i);
  });

  it("rejects non-positive weights", () => {
    const yaml = VALID_YAML.replace("weight: 15", "weight: 0");
    expect(() => parseSystemsGapConfig(yaml)).toThrow();
  });
});

describe("getSystemsGapConfig", () => {
  it("loads the real systems-gap.yaml", () => {
    const config = getSystemsGapConfig();
    expect(config.enabled).toBe(true);
    expect(config.rules.hairdresser?.map((r) => r.name)).toContain("booking_system_missing");
    expect(config.rules.restaurant?.map((r) => r.name)).toContain("online_menu_missing");
    expect(config.rules.car_dealer?.map((r) => r.name)).toContain("contact_form_missing");
  });

  it("caches the parsed config", () => {
    const first = getSystemsGapConfig();
    const second = getSystemsGapConfig();
    expect(second).toBe(first);
  });
});
