import { describe, it, expect } from "vitest";
import { enrichWithDetails } from "../../src/modules/discovery/google-data-enricher.js";
import type { PlaceDetailsResult } from "../../src/modules/discovery/places.js";

const RAW_BASE: Record<string, unknown> = { id: "place1", name: "Test" };

describe("enrichWithDetails — photos_count", () => {
  it("counts photos from details response", () => {
    const details: PlaceDetailsResult = {
      photos: [{ name: "photo1" }, { name: "photo2" }],
    };
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["photos_count"]).toBe(2);
  });

  it("returns photos_count=0 when photos is undefined", () => {
    const details: PlaceDetailsResult = {};
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["photos_count"]).toBe(0);
  });
});

describe("enrichWithDetails — has_hours", () => {
  it("returns has_hours=true when weekdayDescriptions has entries", () => {
    const details: PlaceDetailsResult = {
      regularOpeningHours: { weekdayDescriptions: ["Mon: 9:00–18:00"] },
    };
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_hours"]).toBe(true);
  });

  it("returns has_hours=false when regularOpeningHours is undefined", () => {
    const details: PlaceDetailsResult = {};
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_hours"]).toBe(false);
  });

  it("returns has_hours=false when weekdayDescriptions is empty", () => {
    const details: PlaceDetailsResult = {
      regularOpeningHours: { weekdayDescriptions: [] },
    };
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_hours"]).toBe(false);
  });
});

describe("enrichWithDetails — has_recent_reviews", () => {
  it("returns true when a review is within 180 days", () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const details: PlaceDetailsResult = {
      reviews: [{ publishTime: recentDate, rating: 5 }],
    };
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_recent_reviews"]).toBe(true);
  });

  it("returns false when all reviews are older than 180 days", () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const details: PlaceDetailsResult = {
      reviews: [{ publishTime: oldDate, rating: 3 }],
    };
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_recent_reviews"]).toBe(false);
  });

  it("returns false when reviews is undefined", () => {
    const details: PlaceDetailsResult = {};
    const result = enrichWithDetails(RAW_BASE, details);
    expect(result["has_recent_reviews"]).toBe(false);
  });
});

describe("enrichWithDetails — immutability", () => {
  it("does not mutate the original raw object", () => {
    const raw = { id: "place1" };
    const keysBefore = Object.keys(raw).join(",");
    enrichWithDetails(raw, { photos: [{ name: "photo1" }] });
    expect(Object.keys(raw).join(",")).toBe(keysBefore);
    expect((raw as Record<string, unknown>)["photos_count"]).toBeUndefined();
  });
});
