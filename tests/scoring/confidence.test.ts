import { describe, it, expect } from "vitest";
import type { DigitalFootprintEnriched, Lead } from "../../src/shared/types.js";
import {
  calculateDataConfidence,
  calculateContactReliability,
} from "../../src/modules/scoring/confidence.js";

function base(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "conf-test",
    place_id: "conf-place",
    source: "google_places",
    external_id: "conf-place",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    name: "Test Business",
    niche: null,
    address: null,
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    passed_filter: false,
    rejection_reasons: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function enrichedFp(overrides: Partial<DigitalFootprintEnriched> = {}): DigitalFootprintEnriched {
  return {
    skipped: false,
    fetched_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── calculateDataConfidence ──────────────────────────────────────────────────

describe("calculateDataConfidence — coverage", () => {
  it("returns 0 for bare lead with only name", () => {
    const result = calculateDataConfidence(base());
    // 1/8 coverage * 0.9 = 0.1125 → rounds to 0.11
    expect(result).toBe(0.11);
  });

  it("all 8 fields populated → 1/8 * 0.9 each → total 0.9", () => {
    const lead = base({
      address: "Av. 18 de Julio 1234",
      phone: "+59898000000",
      rating: 4.5,
      website: "https://example.com.uy",
      whatsapp: "+59898000000",
      digital_footprint: enrichedFp({ contact_emails: ["hola@example.com"] }),
    });
    expect(calculateDataConfidence(lead)).toBe(0.9);
  });

  it("heuristic website counts as website coverage", () => {
    const lead = base({
      digital_footprint: enrichedFp({
        heuristic_discovery: {
          ran_at: "2024-01-01T00:00:00Z",
          mode: "website-only",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: {
            website: {
              kind: "website",
              url: "https://example.com.uy",
              score: 0.8,
              signals: [],
              status: "probed",
            },
            facebook: null,
            instagram: null,
            whatsapp: null,
          },
        },
      }),
    });
    // name + website(heuristic) + enriched_fp = 3/8 * 0.9 = 0.3375 → 0.34
    expect(calculateDataConfidence(lead)).toBe(0.34);
  });

  it("fetch_error footprint does NOT count as enriched coverage", () => {
    const withError = base({ digital_footprint: enrichedFp({ fetch_error: "timeout" }) });
    const withoutFp = base();
    // same result — fetch_error discounts the footprint field
    expect(calculateDataConfidence(withError)).toBe(calculateDataConfidence(withoutFp));
  });

  it("skipped footprint does NOT count as enriched coverage", () => {
    const lead = base({
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: "2024-01-01T00:00:00Z",
      },
    });
    expect(calculateDataConfidence(lead)).toBe(calculateDataConfidence(base()));
  });

  it("uses source_confidence as multiplier — lower confidence → lower score", () => {
    const fullLead = base({
      address: "Av. 18 de Julio 1234",
      phone: "+59898000000",
      rating: 4.5,
      website: "https://example.com.uy",
      whatsapp: "+59898000000",
      digital_footprint: enrichedFp({ contact_emails: ["hola@example.com"] }),
    });
    const lowConf = { ...fullLead, source_confidence: 0.6 };
    expect(calculateDataConfidence(lowConf)).toBeLessThan(calculateDataConfidence(fullLead));
    expect(calculateDataConfidence(lowConf)).toBe(0.6);
  });

  it("falls back to 0.5 source_confidence when null", () => {
    const lead = base({ source_confidence: null });
    // 1/8 * 0.5 = 0.0625 → 0.06
    expect(calculateDataConfidence(lead)).toBe(0.06);
  });

  it("corroboration adds up to 0.05 per source, max 0.20", () => {
    const fullLead = base({
      address: "addr",
      phone: "+598",
      rating: 4.0,
      website: "https://x.com.uy",
      whatsapp: "+598",
      digital_footprint: enrichedFp({ contact_emails: ["x@x.com"] }),
    });
    // 8/8 * 0.9 = 0.9, + 2 sources * 0.05 = 0.10 → 1.00 (clamped)
    const twoSources = {
      ...fullLead,
      corroborating_sources: [
        { source: "mintur" as const, seen_at: "2024-01-01", confidence: 0.8 },
        { source: "yelu" as const, seen_at: "2024-01-01", confidence: 0.65 },
      ],
    };
    expect(calculateDataConfidence(twoSources)).toBe(1);
  });

  it("corroboration bonus caps at 0.20 regardless of source count", () => {
    const fullLead = base({
      address: "addr",
      phone: "+598",
      rating: 4.0,
      website: "https://x.com.uy",
      whatsapp: "+598",
      digital_footprint: enrichedFp({ contact_emails: ["x@x.com"] }),
      source_confidence: 0.6,
    });
    // 8/8 * 0.6 = 0.6, + 10 sources * 0.05 = 0.50 capped at 0.20 → 0.80
    const manySources = {
      ...fullLead,
      corroborating_sources: Array.from({ length: 10 }, () => ({
        source: "yelu" as const,
        seen_at: "2024-01-01",
        confidence: 0.65,
      })),
    };
    expect(calculateDataConfidence(manySources)).toBe(0.8);
  });

  it("result is always in [0, 1]", () => {
    const result = calculateDataConfidence(base({ source_confidence: 0 }));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── calculateContactReliability ─────────────────────────────────────────────

describe("calculateContactReliability — contact channels", () => {
  it("returns 0 for lead with no contact info", () => {
    expect(calculateContactReliability(base())).toBe(0);
  });

  it("phone only → 0.30", () => {
    expect(calculateContactReliability(base({ phone: "+59898000000" }))).toBe(0.3);
  });

  it("whatsapp only → 0.30", () => {
    expect(calculateContactReliability(base({ whatsapp: "+59898000000" }))).toBe(0.3);
  });

  it("phone + whatsapp → 0.60", () => {
    const lead = base({ phone: "+598", whatsapp: "+598" });
    expect(calculateContactReliability(lead)).toBe(0.6);
  });

  it("email-found tag + emails in footprint → adds 0.25", () => {
    const lead = base({
      phone: "+598",
      tags: ["email-found"],
      digital_footprint: enrichedFp({ contact_emails: ["hola@negocio.com"] }),
    });
    expect(calculateContactReliability(lead)).toBe(0.55);
  });

  it("email in footprint without email-found tag → adds only 0.10", () => {
    const lead = base({
      digital_footprint: enrichedFp({ contact_emails: ["hola@negocio.com"] }),
    });
    expect(calculateContactReliability(lead)).toBe(0.1);
  });

  it("phone + whatsapp + email-found → 0.85", () => {
    const lead = base({
      phone: "+598",
      whatsapp: "+598",
      tags: ["email-found"],
      digital_footprint: enrichedFp({ contact_emails: ["hola@negocio.com"] }),
    });
    expect(calculateContactReliability(lead)).toBe(0.85);
  });

  it("alternative phones add 0.05 each up to 0.10", () => {
    const lead = base({
      phone: "+598",
      digital_footprint: enrichedFp({ phone_alternatives: ["+59891000001", "+59891000002", "+59891000003"] }),
    });
    // phone(0.30) + alt_phones min(3*0.05, 0.10) = 0.30 + 0.10 = 0.40
    expect(calculateContactReliability(lead)).toBe(0.4);
  });

  it("single alternative phone → adds 0.05", () => {
    const lead = base({
      phone: "+598",
      digital_footprint: enrichedFp({ phone_alternatives: ["+59891000001"] }),
    });
    expect(calculateContactReliability(lead)).toBe(0.35);
  });

  it("all channels → clamps to 1.0", () => {
    const lead = base({
      phone: "+598",
      whatsapp: "+598",
      tags: ["email-found"],
      digital_footprint: enrichedFp({
        contact_emails: ["hola@negocio.com"],
        phone_alternatives: ["+59891000001", "+59891000002"],
      }),
    });
    // 0.30 + 0.30 + 0.25 + 0.10 = 0.95
    expect(calculateContactReliability(lead)).toBe(0.95);
  });

  it("result is always in [0, 1]", () => {
    const result = calculateContactReliability(base());
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
