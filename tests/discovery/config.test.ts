import { describe, it, expect, beforeEach } from "vitest";
import {
  parseDiscoveryConfig,
  getDiscoveryConfig,
  resetDiscoveryConfigCache,
  getProfileConfig,
} from "../../src/modules/discovery/config.js";
import type { ProfileConfig } from "../../src/shared/types.js";

beforeEach(() => {
  resetDiscoveryConfigCache();
});

const VALID_YAML = `
version: 1
profiles:
  a:
    description: "Hidden gem"
    min_rating: 4.3
    min_reviews: 10
    max_reviews: 50
    web_requirement: social_or_missing
  b:
    min_rating: 0
    min_reviews: 101
    max_reviews: null
    web_requirement: missing_only
social_domains:
  - facebook.com
  - instagram.com
persist_rejected: true
`;

describe("parseDiscoveryConfig", () => {
  it("parses a valid YAML and returns DiscoveryConfig", () => {
    const config = parseDiscoveryConfig(VALID_YAML);
    expect(config.version).toBe(1);
    expect(config.profiles["a"]?.min_rating).toBe(4.3);
    expect(config.profiles["b"]?.min_reviews).toBe(101);
    expect(config.social_domains).toContain("facebook.com");
    expect(config.persist_rejected).toBe(true);
  });

  it("throws when version is missing", () => {
    const yaml = VALID_YAML.replace("version: 1\n", "");
    expect(() => parseDiscoveryConfig(yaml)).toThrow(/Invalid discovery config/);
  });

  it("throws when a profile has min_reviews > max_reviews", () => {
    const yaml = `
version: 1
profiles:
  bad:
    min_rating: 4.0
    min_reviews: 100
    max_reviews: 50
    web_requirement: social_or_missing
social_domains: []
persist_rejected: false
`;
    expect(() => parseDiscoveryConfig(yaml)).toThrow(/min_reviews.*cannot exceed max_reviews/);
  });

  it("throws when web_requirement enum is invalid", () => {
    const yaml = `
version: 1
profiles:
  x:
    min_rating: 4.0
    min_reviews: 10
    max_reviews: null
    web_requirement: invalid_value
social_domains: []
persist_rejected: false
`;
    expect(() => parseDiscoveryConfig(yaml)).toThrow(/Invalid discovery config/);
  });
});

describe("getDiscoveryConfig", () => {
  it("loads and caches the bundled discovery.yaml", () => {
    const first = getDiscoveryConfig();
    const second = getDiscoveryConfig();
    expect(first).toBe(second);
    expect(first.version).toBe(1);
    expect(first.profiles["a"]).toBeDefined();
    expect(first.profiles["b"]).toBeDefined();
    expect(first.social_domains.length).toBeGreaterThan(0);
  });
});

describe("getProfileConfig", () => {
  it("returns profile config with overrides applied", () => {
    const overrides: Partial<ProfileConfig> = { min_rating: 4.0 };
    const profile = getProfileConfig("a", overrides);
    expect(profile.min_rating).toBe(4.0);
    expect(profile.min_reviews).toBe(10);
    expect(profile.max_reviews).toBe(50);
  });

  it("throws when overrides create an invalid invariant (min_reviews > max_reviews)", () => {
    expect(() =>
      getProfileConfig("a", { min_reviews: 100 })
    ).toThrow(/min_reviews.*cannot exceed max_reviews/);
  });

  it("throws for unknown profile name", () => {
    expect(() => getProfileConfig("z")).toThrow(/"z"/);
  });
});
