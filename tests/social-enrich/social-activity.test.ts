import { describe, expect, it } from "vitest";
import {
  buildSocialActivitySnapshot,
  classifyActivity,
  classifyAudience,
  parseFacebookMetrics,
  parseInstagramMetrics,
  parseSocialCount,
  instagramProfile,
  instagramProfileFromCounts,
  facebookProfile,
  type SocialActivityProfile,
} from "../../src/modules/social-enrich/social-activity.js";

describe("parseSocialCount", () => {
  it("parsea miles con coma y punto", () => {
    expect(parseSocialCount("1,234")).toBe(1234);
    expect(parseSocialCount("12.345")).toBe(12345);
    expect(parseSocialCount("1,234,567")).toBe(1234567);
  });
  it("parsea sufijos K/M/mil", () => {
    expect(parseSocialCount("10K")).toBe(10000);
    expect(parseSocialCount("1.2K")).toBe(1200);
    expect(parseSocialCount("1.5M")).toBe(1500000);
    expect(parseSocialCount("10 mil")).toBe(10000);
  });
  it("devuelve null para vacío/no numérico", () => {
    expect(parseSocialCount(null)).toBeNull();
    expect(parseSocialCount("abc")).toBeNull();
  });
});

describe("parseInstagramMetrics", () => {
  it("extrae followers/following/posts del og:description (en)", () => {
    const desc = "1,234 Followers, 567 Following, 89 Posts - See Instagram photos and videos from Resto (@resto)";
    expect(parseInstagramMetrics(desc)).toMatchObject({ followers: 1234, following: 567, posts: 89 });
  });
  it("soporta sufijo K y español", () => {
    expect(parseInstagramMetrics("10K seguidores, 200 siguiendo, 350 publicaciones").followers).toBe(10000);
  });
});

describe("parseFacebookMetrics", () => {
  it("extrae likes y talking about", () => {
    const desc = "Mi Resto. 2,500 likes · 45 talking about this · 12 were here.";
    const m = parseFacebookMetrics(desc);
    expect(m.likes).toBe(2500);
    expect(m.talking_about).toBe(45);
  });
});

describe("classifyAudience", () => {
  it("clasifica por umbral", () => {
    expect(classifyAudience(50)).toBe("low");
    expect(classifyAudience(1500)).toBe("medium");
    expect(classifyAudience(20000)).toBe("high");
    expect(classifyAudience(null)).toBeNull();
  });
});

describe("classifyActivity", () => {
  it("activo si última actividad < 90d", () => {
    expect(classifyActivity({ lastActivityAt: "2026-05-20", nowIso: "2026-06-06" })).toBe("active");
  });
  it("abandonado si > 90d", () => {
    expect(classifyActivity({ lastActivityAt: "2026-01-01", nowIso: "2026-06-06" })).toBe("abandoned");
  });
  it("FS-06: talking_about sin fecha NO marca active (snapshot pudo quedar viejo)", () => {
    expect(classifyActivity({ talkingAbout: 45 })).toBe("unknown");
  });
  it("unknown sin señales", () => {
    expect(classifyActivity({})).toBe("unknown");
  });
});

describe("instagramProfile / facebookProfile", () => {
  it("instagramProfile parsea y clasifica", () => {
    const p = instagramProfile("https://instagram.com/resto", "12,000 Followers, 300 Following, 450 Posts - ...");
    expect(p).toMatchObject({ platform: "instagram", followers: 12000, posts: 450, audience_tier: "high" });
  });
  it("facebookProfile: talking_about sin fecha NO afirma active (FS-06)", () => {
    const p = facebookProfile("https://facebook.com/resto", "Resto. 2,500 likes · 45 talking about this");
    expect(p).toMatchObject({ platform: "facebook", likes: 2500, audience_tier: "medium", activity_status: "unknown" });
  });

  it("instagramProfileFromCounts: counts estructurados + actividad por último post (Graph API)", () => {
    const reciente = instagramProfileFromCounts("https://instagram.com/resto", {
      followers: 3200, following: 180, posts: 412,
      lastActivityAt: "2026-06-01T00:00:00Z", nowIso: "2026-06-09T00:00:00Z",
    });
    expect(reciente).toMatchObject({
      platform: "instagram", followers: 3200, following: 180, posts: 412,
      audience_tier: "medium", activity_status: "active",
    });

    const viejo = instagramProfileFromCounts("https://instagram.com/abandonado", {
      followers: 500, following: 90, posts: 20,
      lastActivityAt: "2025-01-01T00:00:00Z", nowIso: "2026-06-09T00:00:00Z",
    });
    expect(viejo.activity_status).toBe("abandoned");
    expect(viejo.audience_tier).toBe("low");

    const sinPost = instagramProfileFromCounts("https://instagram.com/sinpost", {
      followers: 1500, following: 10, posts: 0,
    });
    expect(sinPost.activity_status).toBe("unknown");
    expect(sinPost.audience_tier).toBe("medium");
  });
});

describe("buildSocialActivitySnapshot", () => {
  function profile(overrides: Partial<SocialActivityProfile>): SocialActivityProfile {
    return {
      platform: "instagram",
      url: "https://instagram.com/x",
      followers: null, following: null, posts: null, likes: null, talking_about: null,
      audience_tier: null, activity_status: "unknown",
      ...overrides,
    };
  }

  it("deriva señales: alta audiencia activa sin web", () => {
    const snap = buildSocialActivitySnapshot(
      [profile({ followers: 20000, audience_tier: "high", activity_status: "active" })],
      { ranAt: "2026-06-06T00:00:00Z", hasWebsite: false }
    );
    expect(snap.summary.has_social_presence).toBe(true);
    expect(snap.summary.audience_tier).toBe("high");
    expect(snap.summary.active_platforms).toEqual(["instagram"]);
    expect(snap.summary.commercial_signals).toEqual(expect.arrayContaining(["red_activa", "alta_audiencia", "alta_audiencia_sin_web"]));
  });

  it("marca red_abandonada cuando no hay ninguna activa", () => {
    const snap = buildSocialActivitySnapshot(
      [profile({ followers: 300, activity_status: "abandoned" })],
      { ranAt: "2026-06-06T00:00:00Z", hasWebsite: true }
    );
    expect(snap.summary.commercial_signals).toContain("red_abandonada");
    expect(snap.summary.commercial_signals).not.toContain("alta_audiencia_sin_web");
  });

  it("elige best_platform por mayor audiencia (followers vs likes)", () => {
    const snap = buildSocialActivitySnapshot(
      [
        profile({ platform: "instagram", followers: 500 }),
        profile({ platform: "facebook", likes: 5000 }),
      ],
      { ranAt: "2026-06-06T00:00:00Z", hasWebsite: true }
    );
    expect(snap.summary.best_platform).toBe("facebook");
    expect(snap.summary.audience_tier).toBe("medium");
  });

  it("sin perfiles: sin presencia", () => {
    const snap = buildSocialActivitySnapshot([], { ranAt: "2026-06-06T00:00:00Z", hasWebsite: false });
    expect(snap.summary.has_social_presence).toBe(false);
    expect(snap.summary.commercial_signals).toEqual([]);
  });
});
