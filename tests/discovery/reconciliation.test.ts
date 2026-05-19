import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import { buildRetroactiveReconciliationPlan } from "../../src/modules/discovery/reconciliation.js";

function makeLead(overrides: Partial<Lead> & { id: string; name: string; source: Lead["source"] }): Lead {
  return {
    id: overrides.id,
    place_id: `${overrides.source}:${overrides.id}`,
    source: overrides.source,
    external_id: overrides.external_id ?? overrides.id,
    source_confidence: overrides.source_confidence ?? 0.8,
    source_data: overrides.source_data ?? {},
    data_confidence_score: overrides.data_confidence_score ?? 0.5,
    contact_reliability_score: overrides.contact_reliability_score ?? 0.3,
    canonical_fields: overrides.canonical_fields ?? null,
    corroborating_sources: overrides.corroborating_sources ?? [],
    lead_company_data: overrides.lead_company_data ?? null,
    niche: overrides.niche ?? "tourism",
    name: overrides.name,
    address: overrides.address ?? "Av. Principal 123, Montevideo",
    rating: overrides.rating ?? null,
    review_count: overrides.review_count ?? null,
    website: overrides.website ?? null,
    whatsapp: overrides.whatsapp ?? null,
    phone: overrides.phone ?? null,
    business_status: overrides.business_status ?? null,
    tags: overrides.tags ?? [],
    notes: overrides.notes ?? null,
    state: overrides.state ?? "discovered",
    first_seen_run_id: overrides.first_seen_run_id ?? null,
    last_seen_run_id: overrides.last_seen_run_id ?? null,
    google_data: overrides.google_data ?? null,
    digital_footprint: overrides.digital_footprint ?? null,
    inferred_state: overrides.inferred_state ?? null,
    gps: overrides.gps ?? null,
    reviews_sample: overrides.reviews_sample ?? null,
    business_quality_score: overrides.business_quality_score ?? null,
    digital_gap_score: overrides.digital_gap_score ?? null,
    systems_gap_score: overrides.systems_gap_score ?? null,
    prospect_score: overrides.prospect_score ?? null,
    passed_filter: overrides.passed_filter ?? true,
    rejection_reasons: overrides.rejection_reasons ?? [],
    score_breakdown: overrides.score_breakdown ?? null,
    systems_gap_breakdown: overrides.systems_gap_breakdown ?? null,
    contacted_at: overrides.contacted_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-02T00:00:00.000Z",
  };
}

describe("buildRetroactiveReconciliationPlan", () => {
  it("groups lower-priority cross-source duplicates under the best keeper", () => {
    const primary = makeLead({
      id: "gp-1",
      name: "Hotel Bahia",
      source: "google_places",
      prospect_score: 80,
      data_confidence_score: 0.8,
    });
    const secondaryA = makeLead({
      id: "mt-1",
      name: "Hotel Bahía",
      source: "mintur",
      prospect_score: 20,
    });
    const secondaryB = makeLead({
      id: "yl-1",
      name: "Hotel Bahia",
      source: "yelu",
      prospect_score: 10,
      canonical_fields: {
        email: {
          value: "ventas@hotelbahia.com",
          confidence: 0.9,
          sources: ["yelu"],
          conflict: false,
        },
      },
    });

    const plan = buildRetroactiveReconciliationPlan(
      [secondaryA, secondaryB, primary],
      { threshold: 0.9, geoRadiusMeters: 500 }
    );

    expect(plan.groups_with_matches).toBe(1);
    expect(plan.matched_secondaries).toBe(2);
    expect(plan.expected_remaining_leads).toBe(1);
    expect(plan.groups[0]?.primary.id).toBe("gp-1");
    expect(plan.groups[0]?.secondaries.map((lead) => lead.id)).toEqual(["mt-1", "yl-1"]);
    expect(plan.by_source_pair).toEqual({
      "google_places<-mintur": 1,
      "google_places<-yelu": 1,
    });
  });

  it("does not merge franchise-tagged leads by name alone when addresses differ", () => {
    const primary = makeLead({
      id: "gp-1",
      name: "Abitab Centro",
      source: "google_places",
      tags: ["franchise-detected"],
      address: "18 de Julio 1000, Montevideo",
      prospect_score: 70,
    });
    const secondary = makeLead({
      id: "yl-1",
      name: "Abitab Centro",
      source: "yelu",
      tags: ["franchise-detected"],
      address: "8 de Octubre 2500, Montevideo",
      prospect_score: 15,
    });

    const plan = buildRetroactiveReconciliationPlan(
      [primary, secondary],
      { threshold: 0.9, geoRadiusMeters: 500 }
    );

    expect(plan.groups_with_matches).toBe(0);
    expect(plan.matched_secondaries).toBe(0);
  });

  it("reports phone and email conflicts when both leads disagree", () => {
    const primary = makeLead({
      id: "gp-1",
      name: "Hotel Bahia",
      source: "google_places",
      phone: "099123456",
      canonical_fields: {
        email: {
          value: "hola@bahia.com",
          confidence: 0.8,
          sources: ["google_places"],
          conflict: false,
        },
      },
      prospect_score: 80,
    });
    const secondary = makeLead({
      id: "mt-1",
      name: "Hotel Bahía",
      source: "mintur",
      phone: "091999888",
      canonical_fields: {
        email: {
          value: "reservas@bahia.com",
          confidence: 0.8,
          sources: ["mintur"],
          conflict: false,
        },
      },
      prospect_score: 10,
    });

    const plan = buildRetroactiveReconciliationPlan(
      [primary, secondary],
      { threshold: 0.9, geoRadiusMeters: 500 }
    );

    expect(plan.phone_conflicts).toBe(1);
    expect(plan.email_conflicts).toBe(1);
    expect(plan.matches[0]).toEqual(
      expect.objectContaining({
        phone_conflict: true,
        email_conflict: true,
      })
    );
  });
});
