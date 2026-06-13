import { describe, it, expect } from "vitest";
import { applyProfileFilter, normalizeNiche, tagCandidate } from "../../src/modules/discovery/filters.js";
import type { PlaceCandidate, ProfileConfig } from "../../src/shared/types.js";
import {
  candidateWithSocialWeb,
  candidateWithNoWeb,
  candidateHighReviewsNoWeb,
  candidateHighReviewsWithWeb,
  candidateLowRating,
  candidateTooFewReviews,
  candidateWithRealWeb,
  candidateProfileABorderline,
  candidateWithInstagramWeb,
} from "./fixtures/places.js";

const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "tiktok.com",
  "linktr.ee",
  "beacons.ai",
  "wa.me",
  "bio.link",
];

const profileConfigA: ProfileConfig = {
  min_rating: 4.3,
  min_reviews: 10,
  max_reviews: 50,
  web_requirement: "social_or_missing",
};

const profileConfigB: ProfileConfig = {
  min_rating: 0,
  min_reviews: 101,
  max_reviews: null,
  web_requirement: "missing_only",
};

describe("normalizeNiche", () => {
  it("maps hairdresser terms accent-insensitively", () => {
    expect(normalizeNiche("Peluquería y barbería")).toBe("hairdresser");
  });

  it("keeps default hairdresser normalization without aliases", () => {
    expect(normalizeNiche("peluquería")).toBe("hairdresser");
  });

  it("uses custom aliases when provided", () => {
    const aliases = [
      { niche: "beauty_salon", term: "salon de belleza", matchType: "contains" },
    ];

    expect(normalizeNiche("salon de belleza", aliases)).toBe("beauty_salon");
  });

  it("maps car dealer terms accent-insensitively", () => {
    expect(normalizeNiche("concesionaria de automóviles")).toBe("car_dealer");
  });

  it("BL-02: 'auto/autos' como palabra completa sí, pero auto* compuestos NO", () => {
    expect(normalizeNiche("venta de autos usados")).toBe("car_dealer");
    expect(normalizeNiche("automotora del este")).toBe("car_dealer");
    // No deben caer en car_dealer (vertical equivocado):
    expect(normalizeNiche("autoescuela del centro")).toBe("other");
    expect(normalizeNiche("autoservicio la esquina")).toBe("other");
    expect(normalizeNiche("autopartes el tornillo")).toBe("other");
  });

  it("maps operational systems niches accent-insensitively", () => {
    expect(normalizeNiche("restaurante parrilla")).toBe("restaurant");
    expect(normalizeNiche("gimnasio funcional")).toBe("gym");
    expect(normalizeNiche("clínica médica")).toBe("healthcare");
    expect(normalizeNiche("dentista")).toBe("dentist");
    expect(normalizeNiche("farmacia de barrio")).toBe("pharmacy");
    expect(normalizeNiche("mercado vecinal")).toBe("grocery");
    expect(normalizeNiche("hotel boutique")).toBe("accommodation");
  });

  it("falls back to other for unknown niches", () => {
    expect(normalizeNiche("algo desconocido")).toBe("other");
  });

  it("falls back to other for unknown niches without aliases", () => {
    expect(normalizeNiche("unknown")).toBe("other");
  });
});

// ---- Profile A tests -------------------------------------------------------

describe("Profile A — hidden gem filter", () => {
  it("accepts candidate with social web and rating ≥ 4.3 and reviews 10-50", () => {
    const result = applyProfileFilter([candidateWithSocialWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]?.placeId).toBe("place_001");
  });

  it("accepts candidate with no web and rating ≥ 4.3 and reviews 10-50", () => {
    const result = applyProfileFilter([candidateWithNoWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
  });

  it("accepts borderline candidate: exactly minRating=4.3 and minReviews=10", () => {
    const result = applyProfileFilter([candidateProfileABorderline], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
  });

  it("rejects candidate with a real website", () => {
    const result = applyProfileFilter([candidateWithRealWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("rejects candidate with too many reviews (> 50)", () => {
    const result = applyProfileFilter([candidateHighReviewsNoWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("rejects candidate with too few reviews (< 10)", () => {
    const result = applyProfileFilter([candidateTooFewReviews], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("rejects candidate with rating below 4.3", () => {
    const lowRatingButInRange: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "test_low",
      rating: 4.2,
    };
    const result = applyProfileFilter([lowRatingButInRange], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("respects minRating override when higher than profile default", () => {
    const overrideConfig: ProfileConfig = { ...profileConfigA, min_rating: 4.8 };
    const result = applyProfileFilter([candidateWithSocialWeb], overrideConfig, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("filters a mixed batch correctly", () => {
    const batch = [
      candidateWithSocialWeb,   // should pass
      candidateWithNoWeb,        // should pass
      candidateHighReviewsNoWeb, // too many reviews
      candidateLowRating,        // low rating
      candidateTooFewReviews,    // too few reviews
      candidateWithRealWeb,      // real web
    ];
    const result = applyProfileFilter(batch, profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(2);
    expect(result.passed.map((r) => r.placeId)).toEqual(
      expect.arrayContaining(["place_001", "place_002"])
    );
  });
});

// ---- Profile B tests -------------------------------------------------------

describe("Profile B — saturated no-web filter", () => {
  it("accepts candidate with > 100 reviews and no website", () => {
    const result = applyProfileFilter([candidateHighReviewsNoWeb], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]?.placeId).toBe("place_003");
  });

  it("rejects candidate with > 100 reviews but has a real website", () => {
    const result = applyProfileFilter([candidateHighReviewsWithWeb], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("rejects candidate with < 101 reviews even with no web", () => {
    const result = applyProfileFilter([candidateWithNoWeb], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("rejects candidate with exactly 100 reviews (boundary: needs > 100)", () => {
    const boundary: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "boundary_100",
      userRatingCount: 100,
    };
    const result = applyProfileFilter([boundary], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("accepts candidate with exactly 101 reviews and no web", () => {
    const boundary: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "boundary_101",
      userRatingCount: 101,
    };
    const result = applyProfileFilter([boundary], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
  });

  it("respects minRating override for profile B", () => {
    const overrideConfig: ProfileConfig = { ...profileConfigB, min_rating: 4.5 };
    // candidateHighReviewsNoWeb rating=4.2 < 4.5 → rejected
    const result = applyProfileFilter([candidateHighReviewsNoWeb], overrideConfig, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
  });

  it("filters a mixed batch correctly", () => {
    const batch = [
      candidateHighReviewsNoWeb,   // should pass
      candidateHighReviewsWithWeb, // has web
      candidateWithNoWeb,           // too few reviews
    ];
    const result = applyProfileFilter(batch, profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]?.placeId).toBe("place_003");
  });
});

// ---- Profile D tests -------------------------------------------------------

describe("Profile D — profesional con web débil (web_requirement: any)", () => {
  const profileConfigD: ProfileConfig = {
    min_rating: 4.0,
    min_reviews: 20,
    max_reviews: null,
    web_requirement: "any",
  };

  it("passes a candidate with a real website (web_requirement any does not reject has-real-website)", () => {
    // candidateWithRealWeb: rating 4.4, reviews 30, real website
    const result = applyProfileFilter([candidateWithRealWeb], profileConfigD, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]?.placeId).toBe("place_007");
    const hasWebReason = result.rejected.some((r) => r.reasons.includes("has-real-website"));
    expect(hasWebReason).toBe(false);
  });

  it("passes a candidate with no website (web_requirement any also accepts missing web)", () => {
    // candidateWithNoWeb: rating 4.5, reviews 28, no website
    const result = applyProfileFilter([candidateWithNoWeb], profileConfigD, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]?.placeId).toBe("place_002");
  });
});

// ---- tagCandidate tests ---------------------------------------------------

describe("tagCandidate", () => {
  it("tags facebook-only presence for profile A", () => {
    const tags = tagCandidate(candidateWithSocialWeb, "a", SOCIAL_DOMAINS);
    expect(tags).toContain("profile:a");
    expect(tags).toContain("fb-only-presence");
  });

  it("tags no-website for candidate with no web", () => {
    const tags = tagCandidate(candidateWithNoWeb, "a", SOCIAL_DOMAINS);
    expect(tags).toContain("no-website");
  });

  it("tags instagram-only presence", () => {
    const tags = tagCandidate(candidateWithInstagramWeb, "a", SOCIAL_DOMAINS);
    expect(tags).toContain("ig-only-presence");
  });

  it("tags high reviews + no website together", () => {
    const tags = tagCandidate(candidateHighReviewsNoWeb, "b", SOCIAL_DOMAINS);
    expect(tags).toContain("profile:b");
    expect(tags).toContain("no-website");
    expect(tags).toContain("high-reviews-no-web");
  });

  it("does not emit high-reviews-no-web for candidate with ≤ 100 reviews", () => {
    const tags = tagCandidate(candidateWithNoWeb, "a", SOCIAL_DOMAINS); // 28 reviews
    expect(tags).not.toContain("high-reviews-no-web");
  });

  it("does not emit social-link-only for facebook (uses fb-only-presence instead)", () => {
    const tags = tagCandidate(candidateWithSocialWeb, "a", SOCIAL_DOMAINS);
    expect(tags).not.toContain("social-link-only");
  });

  it("does not emit deprecated tags", () => {
    const allCandidates = [
      candidateWithSocialWeb, candidateWithNoWeb, candidateHighReviewsNoWeb,
      candidateTooFewReviews, candidateWithInstagramWeb,
    ];
    for (const c of allCandidates) {
      const tags = tagCandidate(c, "a", SOCIAL_DOMAINS);
      expect(tags).not.toContain("no-web");
      expect(tags).not.toContain("social-web-only");
      expect(tags).not.toContain("no-phone");
      expect(tags).not.toContain("high-review-count");
      expect(tags).not.toContain("low-review-count");
    }
  });
});

// ---- Extended social domain tests ----------------------------------------

describe("isSocialOrMissingWeb — extended domain list", () => {
  function candidateWithWeb(websiteUri: string): PlaceCandidate {
    return {
      placeId: "test_social",
      name: "Test Business",
      formattedAddress: "Calle Test 1",
      rating: 4.5,
      userRatingCount: 30,
      websiteUri,
      phone: "+59899000000",
      businessStatus: "OPERATIONAL",
      raw: {},
    };
  }

  it("accepts profile A candidate with linktr.ee as their website", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://linktr.ee/mi-negocio")],
      profileConfigA,
      SOCIAL_DOMAINS
    );
    expect(result.passed).toHaveLength(1);
  });

  it("accepts profile A candidate with beacons.ai as their website", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://beacons.ai/mi-negocio")],
      profileConfigA,
      SOCIAL_DOMAINS
    );
    expect(result.passed).toHaveLength(1);
  });

  it("accepts profile A candidate with wa.me link instead of a website", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://wa.me/59899123456")],
      profileConfigA,
      SOCIAL_DOMAINS
    );
    expect(result.passed).toHaveLength(1);
  });

  it("accepts profile A candidate with bio.link", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://bio.link/mi-negocio")],
      profileConfigA,
      SOCIAL_DOMAINS
    );
    expect(result.passed).toHaveLength(1);
  });

  it("rejects profile A candidate with a real business website despite low reviews", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://www.mimegocio.com.uy")],
      profileConfigA,
      SOCIAL_DOMAINS
    );
    expect(result.passed).toHaveLength(0);
  });

  it("tags linktr.ee as social-link-only", () => {
    const tags = tagCandidate(candidateWithWeb("https://linktr.ee/test"), "a", SOCIAL_DOMAINS);
    expect(tags).toContain("social-link-only");
    expect(tags).not.toContain("fb-only-presence");
    expect(tags).not.toContain("ig-only-presence");
  });

  it("tags beacons.ai as social-link-only", () => {
    const tags = tagCandidate(candidateWithWeb("https://beacons.ai/test"), "a", SOCIAL_DOMAINS);
    expect(tags).toContain("social-link-only");
  });
});

// ---- FilterResult shape + rejection tracking tests -----------------------

describe("FilterResult — rejection tracking", () => {
  it("returns { passed, rejected } shape", () => {
    const result = applyProfileFilter([candidateWithSocialWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("rejected");
    expect(Array.isArray(result.passed)).toBe(true);
    expect(Array.isArray(result.rejected)).toBe(true);
  });

  it("handles empty candidates list", () => {
    const result = applyProfileFilter([], profileConfigA, []);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("candidate with rating 3.8 and 200 reviews in profile A → multi-reason rejection", () => {
    const candidate: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "multi_reject",
      rating: 3.8,
      userRatingCount: 200,
    };
    const result = applyProfileFilter([candidate], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    const reasons = result.rejected[0]?.reasons ?? [];
    expect(reasons).toContain("rating-too-low");
    expect(reasons).toContain("reviews-above-max");
  });

  it("candidate with real website in profile A → rejected with has-real-website", () => {
    const result = applyProfileFilter([candidateWithRealWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
    const reasons = result.rejected[0]?.reasons ?? [];
    expect(reasons).toContain("has-real-website");
  });

  it("perfect profile A candidate → in passed, rejected is empty", () => {
    const result = applyProfileFilter([candidateWithSocialWeb], profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("override min_rating=4.0 → candidate rating 4.1 now passes (was rejected at 4.3)", () => {
    const candidate: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "override_pass",
      rating: 4.1,
      userRatingCount: 20,
    };
    const strictConfig: ProfileConfig = { ...profileConfigA, min_rating: 4.3 };
    const lenientConfig: ProfileConfig = { ...profileConfigA, min_rating: 4.0 };

    const strictResult = applyProfileFilter([candidate], strictConfig, SOCIAL_DOMAINS);
    expect(strictResult.passed).toHaveLength(0);

    const lenientResult = applyProfileFilter([candidate], lenientConfig, SOCIAL_DOMAINS);
    expect(lenientResult.passed).toHaveLength(1);
  });

  it("web_requirement=any → no candidates rejected for web reasons", () => {
    const anyConfig: ProfileConfig = { ...profileConfigA, web_requirement: "any" };
    const result = applyProfileFilter([candidateWithRealWeb], anyConfig, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(1);
    const hasWebReason = result.rejected.some((r) =>
      r.reasons.includes("has-real-website")
    );
    expect(hasWebReason).toBe(false);
  });

  it("tagCandidate with new signature (candidate, profile, socialDomains) works correctly", () => {
    const tags = tagCandidate(candidateWithSocialWeb, "a", SOCIAL_DOMAINS);
    expect(tags).toContain("profile:a");
    expect(tags).toContain("fb-only-presence");
  });

  it("mixed batch has correct passed + rejected counts", () => {
    const batch = [
      candidateWithSocialWeb,   // pass
      candidateWithNoWeb,        // pass
      candidateHighReviewsNoWeb, // fail: too many reviews
      candidateWithRealWeb,      // fail: real web
    ];
    const result = applyProfileFilter(batch, profileConfigA, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(2);
    expect(result.rejected).toHaveLength(2);
  });

  it("profile B candidate with reviews below min → rejected with reviews-below-min", () => {
    const result = applyProfileFilter([candidateWithNoWeb], profileConfigB, SOCIAL_DOMAINS);
    expect(result.passed).toHaveLength(0);
    const reasons = result.rejected[0]?.reasons ?? [];
    expect(reasons).toContain("reviews-below-min");
  });

  it("one candidate can accumulate multiple rejection reasons", () => {
    const candidate: PlaceCandidate = {
      placeId: "all_bad",
      name: "Very Bad Candidate",
      formattedAddress: "Somewhere",
      rating: 2.0,
      userRatingCount: 500,
      websiteUri: "https://www.realwebsite.com",
      phone: null,
      businessStatus: "OPERATIONAL",
      raw: {},
    };
    const result = applyProfileFilter([candidate], profileConfigA, SOCIAL_DOMAINS);
    expect(result.rejected).toHaveLength(1);
    const reasons = result.rejected[0]?.reasons ?? [];
    expect(reasons.length).toBeGreaterThan(1);
    expect(reasons).toContain("rating-too-low");
    expect(reasons).toContain("reviews-above-max");
    expect(reasons).toContain("has-real-website");
  });
});
