import { describe, expect, it } from "vitest";
import { businessDomain, normalizePhone, contactKeys } from "../../src/modules/discovery/contact-match.js";
import { buildContactMergePlan, DEFAULT_CONTACT_MERGE_OPTS } from "../../src/modules/discovery/contact-reconciliation.js";
import type { Lead } from "../../src/shared/types.js";

function lead(overrides: Partial<Lead> & { id: string; source: Lead["source"]; name: string }): Lead {
  return {
    id: overrides.id,
    place_id: `${overrides.source}:${overrides.id}`,
    source: overrides.source,
    external_id: overrides.id,
    source_confidence: 0.7,
    source_data: null,
    data_confidence_score: 0.5,
    contact_reliability_score: 0.3,
    canonical_fields: overrides.canonical_fields ?? null,
    corroborating_sources: [],
    canonical_source: null,
    lead_company_data: null,
    niche: overrides.niche ?? "restaurant",
    name: overrides.name,
    address: overrides.address ?? "calle 1, Montevideo, Uruguay",
    rating: null, review_count: null,
    website: overrides.website ?? null,
    whatsapp: null,
    phone: overrides.phone ?? null,
    business_status: null,
    tags: [], notes: null, state: "discovered",
    first_seen_run_id: null, last_seen_run_id: null,
    google_data: null, digital_footprint: null, inferred_state: null,
    gps: null, reviews_sample: null,
    business_quality_score: null, digital_gap_score: null, systems_gap_score: null,
    prospect_score: overrides.prospect_score ?? null,
    passed_filter: true, rejection_reasons: [],
    score_breakdown: null, systems_gap_breakdown: null, contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("contact-match helpers", () => {
  it("normalizePhone canoniza a la clave nacional (IT-01: colapsa grafías)", () => {
    expect(normalizePhone("099 123 456")).toBe("99123456");
    expect(normalizePhone("+598 99 123 456")).toBe("99123456");
    expect(normalizePhone("2-44")).toBeNull();
  });
  it("businessDomain excluye plataformas/redes", () => {
    expect(businessDomain("https://www.miresto.com.uy/menu")).toBe("miresto.com.uy");
    expect(businessDomain("https://instagram.com/miresto")).toBeNull();
    expect(businessDomain("https://m.facebook.com/x")).toBeNull();
    expect(businessDomain("https://yelu.uy/company/1")).toBeNull();
  });
  it("contactKeys junta directos y canonical", () => {
    const l = lead({ id: "1", source: "mintur", name: "X", phone: "099111222", canonical_fields: { email: { value: "a@b.com" } } });
    expect(contactKeys(l)).toEqual({ phones: ["99111222"], domains: [], emails: ["a@b.com"] });
  });
});

describe("buildContactMergePlan", () => {
  it("auto-une por teléfono compartido entre fuentes distintas, misma ciudad", () => {
    const leads = [
      lead({ id: "g1", source: "google_places", name: "Parrilla Don José", phone: "099123456" }),
      lead({ id: "y1", source: "yelu", name: "Don Jose Restaurant", phone: "099 123 456" }),
    ];
    const plan = buildContactMergePlan(leads);
    expect(plan.auto).toHaveLength(1);
    expect(plan.auto[0]).toMatchObject({ primary_id: "g1", secondary_id: "y1", kind: "phone", reason: "shared-phone" });
  });

  it("manda a revisión si las ciudades difieren", () => {
    const leads = [
      lead({ id: "g1", source: "google_places", name: "Sucursal Centro", phone: "099123456", address: "x, Montevideo, Uruguay" }),
      lead({ id: "m1", source: "mintur", name: "Sucursal Costa", phone: "099123456", address: "y, Maldonado, Maldonado" }),
    ];
    const plan = buildContactMergePlan(leads);
    expect(plan.auto).toHaveLength(0);
    expect(plan.review[0]).toMatchObject({ reason: "city-mismatch" });
  });

  it("no auto-une cadenas (clave compartida por muchos leads) y las reporta", () => {
    const leads = [
      lead({ id: "g1", source: "google_places", name: "Farmashop 1", website: "https://farmashop.com.uy", address: "a, Montevideo, Uruguay" }),
      lead({ id: "g2", source: "google_places", name: "Farmashop 2", website: "https://farmashop.com.uy", address: "b, Montevideo, Uruguay" }),
      lead({ id: "y1", source: "yelu", name: "Farmashop 3", website: "https://farmashop.com.uy", address: "c, Montevideo, Uruguay" }),
      lead({ id: "y2", source: "yelu", name: "Farmashop 4", website: "https://farmashop.com.uy", address: "d, Montevideo, Uruguay" }),
      lead({ id: "m1", source: "mintur", name: "Farmashop 5", website: "https://farmashop.com.uy", address: "e, Montevideo, Uruguay" }),
    ];
    const plan = buildContactMergePlan(leads, { ...DEFAULT_CONTACT_MERGE_OPTS, maxKeyGroupSize: 4 });
    expect(plan.auto).toHaveLength(0);
    expect(plan.chains).toEqual([{ kind: "domain", key: "farmashop.com.uy", lead_count: 5 }]);
    expect(plan.review.every((c) => c.reason === "chain-suspected")).toBe(true);
  });

  it("ignora claves compartidas dentro de la misma fuente", () => {
    const leads = [
      lead({ id: "y1", source: "yelu", name: "A", phone: "099123456" }),
      lead({ id: "y2", source: "yelu", name: "B", phone: "099123456" }),
    ];
    const plan = buildContactMergePlan(leads);
    expect(plan.auto).toHaveLength(0);
    expect(plan.review).toHaveLength(0);
  });

  it("dominio compartido con nombres parecidos auto-une; con nombres dispares va a revisión", () => {
    const similar = buildContactMergePlan([
      lead({ id: "g1", source: "google_places", name: "Resto La Huella", website: "https://lahuella.com.uy" }),
      lead({ id: "y1", source: "yelu", name: "La Huella", website: "https://lahuella.com.uy" }),
    ]);
    expect(similar.auto).toHaveLength(1);
    expect(similar.auto[0]?.reason).toBe("shared-domain");

    const dispar = buildContactMergePlan([
      lead({ id: "g2", source: "google_places", name: "Kiosco Norte", website: "https://grupoxyz.com.uy" }),
      lead({ id: "m2", source: "mintur", name: "Importadora Sur SA", website: "https://grupoxyz.com.uy" }),
    ]);
    expect(dispar.auto).toHaveLength(0);
    expect(dispar.review[0]?.reason).toBe("shared-domain-low-name-sim");
  });
});
