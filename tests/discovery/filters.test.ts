import { describe, it, expect } from "vitest";
import { applyProfileFilter, tagCandidate } from "../../src/modules/discovery/filters.js";
import type { PlaceCandidate } from "../../src/shared/types.js";
import {
  candidateWithSocialWeb,
  candidateWithNoWeb,
  candidateHighReviewsNoWeb,
  candidateHighReviewsWithWeb,
  candidateLowRating,
  candidateTooFewReviews,
  candidateWithRealWeb,
  candidateProfileABorderline,
} from "./fixtures/places.js";

// ---- Profile A tests -------------------------------------------------------

describe("Profile A — hidden gem filter", () => {
  const minRating = 4.0;

  it("accepts candidate with social web and rating ≥ 4.3 and reviews 10-50", () => {
    const result = applyProfileFilter([candidateWithSocialWeb], "a", minRating);
    expect(result).toHaveLength(1);
    expect(result[0]?.placeId).toBe("place_001");
  });

  it("accepts candidate with no web and rating ≥ 4.3 and reviews 10-50", () => {
    const result = applyProfileFilter([candidateWithNoWeb], "a", minRating);
    expect(result).toHaveLength(1);
  });

  it("accepts borderline candidate: exactly minRating=4.3 and minReviews=10", () => {
    const result = applyProfileFilter([candidateProfileABorderline], "a", minRating);
    expect(result).toHaveLength(1);
  });

  it("rejects candidate with a real website", () => {
    const result = applyProfileFilter([candidateWithRealWeb], "a", minRating);
    expect(result).toHaveLength(0);
  });

  it("rejects candidate with too many reviews (> 50)", () => {
    const result = applyProfileFilter([candidateHighReviewsNoWeb], "a", minRating);
    expect(result).toHaveLength(0);
  });

  it("rejects candidate with too few reviews (< 10)", () => {
    const result = applyProfileFilter([candidateTooFewReviews], "a", minRating);
    expect(result).toHaveLength(0);
  });

  it("rejects candidate with rating below 4.3", () => {
    const lowRatingButInRange: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "test_low",
      rating: 4.2,
    };
    const result = applyProfileFilter([lowRatingButInRange], "a", minRating);
    expect(result).toHaveLength(0);
  });

  it("respects minRating override when higher than profile default", () => {
    const result = applyProfileFilter([candidateWithSocialWeb], "a", 4.8);
    expect(result).toHaveLength(0);
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
    const result = applyProfileFilter(batch, "a", minRating);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.placeId)).toEqual(
      expect.arrayContaining(["place_001", "place_002"])
    );
  });
});

// ---- Profile B tests -------------------------------------------------------

describe("Profile B — saturated no-web filter", () => {
  const minRating = 0;

  it("accepts candidate with > 100 reviews and no website", () => {
    const result = applyProfileFilter([candidateHighReviewsNoWeb], "b", minRating);
    expect(result).toHaveLength(1);
    expect(result[0]?.placeId).toBe("place_003");
  });

  it("rejects candidate with > 100 reviews but has a real website", () => {
    const result = applyProfileFilter([candidateHighReviewsWithWeb], "b", minRating);
    expect(result).toHaveLength(0);
  });

  it("rejects candidate with < 101 reviews even with no web", () => {
    const result = applyProfileFilter([candidateWithNoWeb], "b", minRating);
    expect(result).toHaveLength(0);
  });

  it("rejects candidate with exactly 100 reviews (boundary: needs > 100)", () => {
    const boundary: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "boundary_100",
      userRatingCount: 100,
    };
    const result = applyProfileFilter([boundary], "b", minRating);
    expect(result).toHaveLength(0);
  });

  it("accepts candidate with exactly 101 reviews and no web", () => {
    const boundary: PlaceCandidate = {
      ...candidateWithNoWeb,
      placeId: "boundary_101",
      userRatingCount: 101,
    };
    const result = applyProfileFilter([boundary], "b", minRating);
    expect(result).toHaveLength(1);
  });

  it("respects minRating override for profile B", () => {
    const result = applyProfileFilter([candidateHighReviewsNoWeb], "b", 4.5);
    // rating 4.2 < 4.5, so it should be rejected
    expect(result).toHaveLength(0);
  });

  it("filters a mixed batch correctly", () => {
    const batch = [
      candidateHighReviewsNoWeb,   // should pass
      candidateHighReviewsWithWeb, // has web
      candidateWithNoWeb,           // too few reviews
    ];
    const result = applyProfileFilter(batch, "b", minRating);
    expect(result).toHaveLength(1);
    expect(result[0]?.placeId).toBe("place_003");
  });
});

// ---- tagCandidate tests ---------------------------------------------------

describe("tagCandidate", () => {
  it("tags profile A leads correctly", () => {
    const tags = tagCandidate(candidateWithSocialWeb, "a");
    expect(tags).toContain("profile:a");
    expect(tags).toContain("social-web-only");
    expect(tags).toContain("low-review-count");
  });

  it("tags no-web leads", () => {
    const tags = tagCandidate(candidateWithNoWeb, "a");
    expect(tags).toContain("no-web");
  });

  it("tags high review count", () => {
    const tags = tagCandidate(candidateHighReviewsNoWeb, "b");
    expect(tags).toContain("profile:b");
    expect(tags).toContain("no-web");
    expect(tags).toContain("high-review-count");
  });

  it("tags no-phone leads", () => {
    const tags = tagCandidate(candidateTooFewReviews, "a");
    expect(tags).toContain("no-phone");
  });
});

// ---- Extended social domain tests ----------------------------------------

describe("isSocialOrMissingWeb — extended domain list", () => {
  const minRating = 4.0;

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
      "a",
      minRating
    );
    expect(result).toHaveLength(1);
  });

  it("accepts profile A candidate with beacons.ai as their website", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://beacons.ai/mi-negocio")],
      "a",
      minRating
    );
    expect(result).toHaveLength(1);
  });

  it("accepts profile A candidate with wa.me link instead of a website", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://wa.me/59899123456")],
      "a",
      minRating
    );
    expect(result).toHaveLength(1);
  });

  it("accepts profile A candidate with bio.link", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://bio.link/mi-negocio")],
      "a",
      minRating
    );
    expect(result).toHaveLength(1);
  });

  it("rejects profile A candidate with a real business website despite low reviews", () => {
    const result = applyProfileFilter(
      [candidateWithWeb("https://www.mimegocio.com.uy")],
      "a",
      minRating
    );
    expect(result).toHaveLength(0);
  });
});
