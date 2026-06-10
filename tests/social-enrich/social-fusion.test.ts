import { describe, expect, it } from "vitest";
import type { Lead } from "../../src/shared/types.js";
import {
  buildSocialFusion,
  extractUsernameFromUrl,
  type SocialProfileData,
} from "../../src/modules/social-enrich/social-fusion.js";

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

function profile(overrides: Partial<SocialProfileData> = {}): SocialProfileData {
  return {
    username: "panaderiagodoy",
    name: "Panadería Godoy",
    biography: "Pan artesanal. Pedidos 099123456. info@panaderiagodoy.uy",
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

describe("extractUsernameFromUrl", () => {
  it("saca el handle de perfiles y rechaza posts/sistema", () => {
    expect(extractUsernameFromUrl("https://www.instagram.com/panaderiagodoy/")).toBe("panaderiagodoy");
    expect(extractUsernameFromUrl("instagram.com/la.proa?hl=es")).toBe("la.proa");
    expect(extractUsernameFromUrl("https://www.instagram.com/p/Cabc/")).toBeNull();
    expect(extractUsernameFromUrl(null)).toBeNull();
  });
});

describe("buildSocialFusion", () => {
  it("fusiona bio + métricas (regex-only) desde un perfil social agnóstico", async () => {
    const r = await buildSocialFusion(makeLead(), IG_URL, profile(), CTX);
    expect(r.socialSearch.instagram?.bio).toContain("Pan artesanal");
    expect(r.socialSearch.instagram?.liveness?.state).toBe("alive");
    expect(r.tags).toContain("ig-confirmed");
    expect(r.socialActivity.profiles.instagram).toMatchObject({ followers: 3200, activity_status: "active" });
    const phone = (r.socialCanonical as Record<string, { value?: string }>)["phone"];
    expect(phone?.value).toContain("99123456");
  });

  it("sin actividad reciente (snippet sin timestamps) → activity_status unknown, igual fusiona métricas", async () => {
    const r = await buildSocialFusion(makeLead(), IG_URL, profile({ recent_media: [], biography: "Solo nombre", followers_count: 800 }), CTX);
    expect(r.socialActivity.profiles.instagram?.activity_status).toBe("unknown");
    expect(r.socialActivity.profiles.instagram?.followers).toBe(800);
  });

  it("bio nula no rompe", async () => {
    const r = await buildSocialFusion(makeLead(), IG_URL, profile({ biography: null, website: null }), CTX);
    expect(r.socialSearch.instagram?.bio).toBeNull();
    expect(r.socialActivity.profiles.instagram?.followers).toBe(3200);
  });
});
