import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import { buildInstagramGraphFusion } from "../../src/modules/social-enrich/graph-enrich.js";
import type { GraphBusinessProfile } from "../../src/modules/social-enrich/graph-api.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1", place_id: "place-1", niche: "panaderia", name: "Panadería Godoy",
    address: "Montevideo, Uruguay", rating: null, review_count: null, website: null,
    whatsapp: null, phone: null, business_status: null, tags: [], notes: null,
    state: "discovered", first_seen_run_id: "r1", last_seen_run_id: "r1", google_data: null,
    digital_footprint: null, reviews_sample: null, business_quality_score: null,
    digital_gap_score: null, systems_gap_score: null, prospect_score: null, passed_filter: true,
    rejection_reasons: [], score_breakdown: null, systems_gap_breakdown: null, contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function profile(overrides: Partial<GraphBusinessProfile> = {}): GraphBusinessProfile {
  return {
    username: "panaderiagodoy",
    name: "Panadería Godoy",
    biography: "Pan artesanal. Pedidos 099123456. Lun a Sáb. info@panaderiagodoy.uy",
    followers_count: 3200,
    follows_count: 180,
    media_count: 412,
    website: "https://panaderiagodoy.uy",
    recent_media: [{ caption: "Hoy", timestamp: "2026-06-01T00:00:00Z", like_count: 40, comments_count: 3 }],
    ...overrides,
  };
}

const IG_URL = "https://www.instagram.com/panaderiagodoy";
const CTX = { ranAt: "2026-06-09T00:00:00Z", nowIso: "2026-06-09T00:00:00Z", hasWebsite: false, allowLlm: false };

describe("buildInstagramGraphFusion", () => {
  it("produce socialSearch + actividad + canonical desde el perfil de la API (regex-only)", async () => {
    const r = await buildInstagramGraphFusion(makeLead(), IG_URL, profile(), CTX);

    expect(r.socialSearch.source).toBe("playwright");
    expect(r.socialSearch.instagram?.bio).toContain("Pan artesanal");
    expect(r.socialSearch.instagram?.liveness?.state).toBe("alive");
    expect(r.tags).toContain("ig-confirmed");

    // Actividad: último post reciente → active; 3200 followers → medium.
    expect(r.socialActivity.profiles.instagram).toMatchObject({
      followers: 3200, activity_status: "active", audience_tier: "medium",
    });

    // El parser regex sacó el teléfono de la bio y entró a canonical_fields.
    expect(r.socialCanonical).not.toBeNull();
    const phone = (r.socialCanonical as Record<string, { value?: string }>)["phone"];
    expect(phone?.value).toContain("099123456".replace(/^0/, "")); // normalizado +598...
  });

  it("cuenta sin actividad reciente → activity_status unknown, igual fusiona métricas", async () => {
    const r = await buildInstagramGraphFusion(
      makeLead(),
      IG_URL,
      profile({ recent_media: [], biography: "Solo nombre", followers_count: 800 }),
      CTX
    );
    expect(r.socialActivity.profiles.instagram?.activity_status).toBe("unknown");
    expect(r.socialActivity.profiles.instagram?.audience_tier).toBe("low");
    expect(r.socialSearch.instagram?.name).toBe("Panadería Godoy");
  });

  it("bio vacía no rompe: devuelve resultado con canonical posiblemente nulo", async () => {
    const r = await buildInstagramGraphFusion(
      makeLead(),
      IG_URL,
      profile({ biography: null, website: null }),
      CTX
    );
    expect(r.socialSearch.instagram?.bio).toBeNull();
    expect(r.socialActivity.profiles.instagram?.followers).toBe(3200);
  });
});
