import { describe, expect, it } from "vitest";
import { applyProfileFilter } from "../../src/modules/discovery/filters.js";
import type { PlaceCandidate, ProfileConfig } from "../../src/shared/types.js";

const baseProfile: ProfileConfig = {
  min_rating: 3.5,
  min_reviews: 10,
  max_reviews: null,
  web_requirement: "any",
};

function makeCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    placeId: "ChIJ_test",
    name: "Test Place",
    formattedAddress: "Calle Test 123, Montevideo",
    rating: 4.0,
    userRatingCount: 50,
    websiteUri: null,
    phone: null,
    businessStatus: "OPERATIONAL",
    primaryType: "restaurant",
    raw: {},
    lat: -34.9,
    lng: -56.1,
    geo_suspect: false,
    departamento: "Montevideo",
    ...overrides,
  };
}

describe("OPT-1: geo-out-of-bounds rejection", () => {
  it("rejects candidates with geo_suspect=true", () => {
    const candidate = makeCandidate({ geo_suspect: true, lat: -33.0, lng: -57.0 });
    const { passed, rejected } = applyProfileFilter([candidate], baseProfile, []);

    expect(passed).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reasons).toContain("geo-out-of-bounds");
  });

  it("passes candidates with geo_suspect=false and valid profile", () => {
    const candidate = makeCandidate({ geo_suspect: false });
    const { passed, rejected } = applyProfileFilter([candidate], baseProfile, []);

    expect(passed).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects geo_suspect=true even when rating and reviews pass", () => {
    const candidate = makeCandidate({ geo_suspect: true, rating: 4.9, userRatingCount: 1000 });
    const { rejected } = applyProfileFilter([candidate], baseProfile, []);

    expect(rejected[0]!.reasons).toContain("geo-out-of-bounds");
  });

  it("accumulates geo-out-of-bounds alongside other reasons", () => {
    const candidate = makeCandidate({ geo_suspect: true, rating: 1.0, userRatingCount: 0 });
    const { rejected } = applyProfileFilter([candidate], baseProfile, []);

    const reasons = rejected[0]!.reasons;
    expect(reasons).toContain("geo-out-of-bounds");
    expect(reasons).toContain("rating-too-low");
    expect(reasons).toContain("reviews-below-min");
  });

  it("does not reject when geo_suspect is false but rating is low", () => {
    const candidate = makeCandidate({ geo_suspect: false, rating: 1.0 });
    const { rejected } = applyProfileFilter([candidate], baseProfile, []);

    expect(rejected[0]!.reasons).not.toContain("geo-out-of-bounds");
    expect(rejected[0]!.reasons).toContain("rating-too-low");
  });

  it("does not reject when geo_suspect is undefined", () => {
    const candidate = makeCandidate();
    delete (candidate as { geo_suspect?: boolean }).geo_suspect;
    const { passed } = applyProfileFilter([candidate], baseProfile, []);
    expect(passed).toHaveLength(1);
  });
});
