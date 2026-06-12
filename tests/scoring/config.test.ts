import { describe, it, expect, beforeEach } from "vitest";
import { getScoringConfig, parseConfig, resetScoringConfigCache } from "../../src/modules/scoring/config.js";

beforeEach(() => {
  resetScoringConfigCache();
});

const VALID_YAML = `
version: 2
recent_reviews_threshold_days: 180
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
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus:
    google_places: 0
    osm: 8
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
      - { min: 4.3, max: 5.01, points: 5 }
    review_tiers:
      - { min: 20, max: 50, points: 1 }
      - { min: 50, max: null, points: 3 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds:
  hot: 55
  pitcheable: 40
  pool: 25
pitch_hooks:
  web_nuevo:
    default: "No tienen web."
  rediseno:
    default: "Su web existe."
  marketing:
    default: "Les falta marketing."
  software:
    default: "Sin sistema propio."
  catalogo:
    default: "Les falta catalogo."
  contacto_directo:
    default: "Solo contacto directo."
`;

describe("parseConfig", () => {
  it("parses valid YAML and returns a ScoringConfig", () => {
    const config = parseConfig(VALID_YAML);
    expect(config.version).toBe(2);
    expect(config.recent_reviews_threshold_days).toBe(180);
    expect(config.business_quality.rules).toHaveLength(2);
    expect(config.digital_gap.rules).toHaveLength(1);
    expect(config.cap).toBe(100);
    expect(config.prospect_formula).toBe("commercial_score_v2");
    expect(config.thresholds.hot).toBe(55);
    expect(config.pitch_hooks.contacto_directo.default).toContain("contacto");
  });

  it("throws when version is missing", () => {
    const yaml = VALID_YAML.replace("version: 2\n", "");
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("throws when recent_reviews_threshold_days is not positive", () => {
    const yaml = VALID_YAML.replace("recent_reviews_threshold_days: 180", "recent_reviews_threshold_days: 0");
    expect(() => parseConfig(yaml)).toThrow(/recent_reviews_threshold_days/i);
  });

  it("throws when a rule has non-numeric weight", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
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
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("accepts negative rule weights", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
business_quality:
  rules: []
digital_gap:
  rules:
    - name: chat_widget_present
      condition: { tag: chat-widget }
      weight: -3
mutual_exclusions:
  business_quality: []
  digital_gap: []
cap: 100
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    const config = parseConfig(yaml);
    expect(config.digital_gap.rules).toContainEqual({
      name: "chat_widget_present",
      condition: { tag: "chat-widget" },
      weight: -3,
    });
  });

  it("throws when prospect_formula is absent", () => {
    const yaml = VALID_YAML.replace('prospect_formula: "commercial_score_v2"\n', "");
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("throws when a dimension has duplicate rule names", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
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
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    expect(() => parseConfig(yaml)).toThrow(/Duplicate rule name/i);
  });
});

describe("getScoringConfig", () => {
  it("loads the real scoring.yaml and returns valid config", () => {
    const config = getScoringConfig();
    expect(config.version).toBe(3);
    expect(config.recent_reviews_threshold_days).toBe(180);
    expect(config.business_quality.rules.length).toBeGreaterThan(0);
    expect(config.digital_gap.rules.length).toBeGreaterThan(0);
    expect(config.commercial_score.source_quality_bonus.osm).toBe(8);
    expect(config.thresholds.hot).toBe(50); // canary del valor real; alineación 50↔55 → N6.1
    expect(config.pitch_hooks.software.default).toContain("sistema");
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
      name: "high_reviews_no_web",
      condition: { tag: "high-reviews-no-web" },
      weight: 10,
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
    expect(config.digital_gap.rules).toContainEqual({
      name: "email_missing",
      condition: { tag: "email-missing" },
      weight: 5,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "chat_widget_present",
      condition: { tag: "chat-widget" },
      weight: -3,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "chat_widget_missing",
      condition: { tag: "chat-widget-missing" },
      weight: 3,
    });
    expect(config.digital_gap.rules).toContainEqual({
      name: "hours_missing_on_web",
      condition: { tag: "hours-missing-on-web" },
      weight: 3,
    });
    expect(config.mutual_exclusions.digital_gap).toContainEqual([
      "whatsapp_confirmed",
      "whatsapp_derived",
      "whatsapp_missing",
    ]);
    expect(config.prospect_formula).toBe("commercial_score_v3");
  });

  it("singleton: two calls return the same object reference", () => {
    const first = getScoringConfig();
    const second = getScoringConfig();
    expect(second).toBe(first);
  });
});

describe("parseConfig — gap-3 validation regression", () => {
  it("throws when mutual_exclusions references an unknown business_quality rule", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
business_quality:
  rules:
    - name: rating_excellent
      condition: { field: rating, op: gte, value: 4.5 }
      weight: 25
digital_gap:
  rules:
    - name: no_website
      condition: { tag: no-website }
      weight: 35
mutual_exclusions:
  business_quality:
    - [rating_excellent, nonexistent_rule]
  digital_gap: []
cap: 100
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    expect(() => parseConfig(yaml)).toThrow(/Unknown rule/i);
  });

  it("throws when cap is zero or negative", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
business_quality:
  rules:
    - name: rating_excellent
      condition: { field: rating, op: gte, value: 4.5 }
      weight: 25
digital_gap:
  rules:
    - name: no_website
      condition: { tag: no-website }
      weight: 35
mutual_exclusions:
  business_quality: []
  digital_gap: []
cap: -1
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    expect(() => parseConfig(yaml)).toThrow(/cap must be > 0/i);
  });

  it("valid config with mutual_exclusions referencing real rules loads without error", () => {
    const yaml = `
version: 2
recent_reviews_threshold_days: 180
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
prospect_formula: "commercial_score_v2"
commercial_score:
  gap_depth_cap: 60
  source_quality_bonus: { google_places: 0 }
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers:
      - { min: 4.0, max: 4.3, points: 2 }
    review_tiers:
      - { min: 20, max: null, points: 1 }
    data_confidence_multiplier: 3
    contact_reliability_multiplier: 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }
    score_adjustment: { base: 0.9, weight: 0.22 }
    contact_score:
      weights: { email: 30, extra_email: 5, whatsapp_direct: 28, whatsapp_derived: 18, phone: 18, phone_landline: 8, phone_confirmed_bonus: 6, address: 8, website: 6, contact_form: 4, social_dm_channel: 3, whatsapp_web_link: 5, multi_channel_bonus: 6, high_confidence_bonus: 4 }
      thresholds: { A: 70, B: 45, C: 24, D: 8 }
      cap: 100
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }
thresholds: { hot: 55, pitcheable: 40, pool: 25 }
pitch_hooks:
  web_nuevo: { default: "No tienen web." }
  rediseno: { default: "Su web existe." }
  marketing: { default: "Les falta marketing." }
  software: { default: "Sin sistema propio." }
  catalogo: { default: "Les falta catalogo." }
  contacto_directo: { default: "Solo contacto directo." }
`;
    expect(() => parseConfig(yaml)).not.toThrow();
  });
});
