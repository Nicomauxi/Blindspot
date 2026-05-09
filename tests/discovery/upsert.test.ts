/**
 * Integration tests for upsertLeads flip logic.
 * REQUIRES local Supabase running — run `pnpm supabase start` first.
 * Execute with: pnpm vitest run tests/discovery/upsert.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { upsertLeads } from "../../src/storage/leads.js";
import { createRun } from "../../src/storage/runs.js";
import { getSupabase } from "../../src/shared/supabase.js";
import type { PlaceCandidate } from "../../src/shared/types.js";

// Real run IDs created in beforeAll — required to satisfy FK constraints on
// leads.first_seen_run_id and leads.last_seen_run_id → runs(id).
let run1Id: string;
let run2Id: string;
const describeIfSupabase =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.GOOGLE_PLACES_API_KEY
    ? describe
    : describe.skip;

function makePlaceId(): string {
  return `upsert_test_${crypto.randomUUID()}`;
}

function makeCandidate(placeId: string): PlaceCandidate {
  return {
    placeId,
    name: "Test Business Upsert",
    formattedAddress: "Test Street 123",
    rating: 4.5,
    userRatingCount: 30,
    websiteUri: null,
    phone: null,
    businessStatus: "OPERATIONAL",
    raw: { source: "test" },
  };
}

function tagsFn(_c: PlaceCandidate): string[] {
  return ["profile:a", "no-website"];
}

describeIfSupabase("upsertLeads — flip logic integration", () => {
  beforeAll(async () => {
    const [r1, r2] = await Promise.all([
      createRun({ niche: "test_niche", location: "test_location", profile: "a", maxResults: 1, config: {} }),
      createRun({ niche: "test_niche", location: "test_location", profile: "a", maxResults: 1, config: {} }),
    ]);
    run1Id = r1.id;
    run2Id = r2.id;
  });

  afterAll(async () => {
    const db = getSupabase();
    // Delete leads first (FK points from leads → runs).
    // All leads created by these tests have first_seen_run_id = run1Id.
    await db.from("leads").delete().in("first_seen_run_id", [run1Id, run2Id]);
    await db.from("runs").delete().in("id", [run1Id, run2Id]);
  });

  it("inserts a passed lead with passed_filter=true and empty rejection_reasons", async () => {
    const candidate = makeCandidate(makePlaceId());

    const { inserted } = await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [] }],
      run1Id,
      "a",
      tagsFn
    );
    expect(inserted).toHaveLength(1);
    const lead = inserted[0]!;
    expect(lead.passed_filter).toBe(true);
    expect(lead.rejection_reasons).toEqual([]);
    expect(lead.tags).toContain("profile:a");
    expect(lead.tags).toContain("no-website");
  });

  it("inserts a rejected lead with passed_filter=false and rejection_reasons set", async () => {
    const candidate = makeCandidate(makePlaceId());

    const { inserted } = await upsertLeads(
      [{ candidate, passed: false, rejection_reasons: ["rating-too-low", "reviews-above-max"] }],
      run1Id,
      "a",
      tagsFn
    );
    expect(inserted).toHaveLength(1);
    const lead = inserted[0]!;
    expect(lead.passed_filter).toBe(false);
    expect(lead.rejection_reasons).toEqual(["rating-too-low", "reviews-above-max"]);
    expect(lead.tags).toContain("rejected:rating-too-low");
    expect(lead.tags).toContain("rejected:reviews-above-max");
  });

  it("flip rejected→passed: clears rejection_reasons, removes rejected tags, adds normal tags, preserves first_seen_run_id", async () => {
    const candidate = makeCandidate(makePlaceId());

    // First insert as rejected
    const { inserted } = await upsertLeads(
      [{ candidate, passed: false, rejection_reasons: ["rating-too-low"] }],
      run1Id,
      "a",
      tagsFn
    );
    const firstSeenRunId = inserted[0]!.first_seen_run_id;

    // Now re-discover as passed
    const { updated } = await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [] }],
      run2Id,
      "a",
      tagsFn
    );
    expect(updated).toHaveLength(1);
    const lead = updated[0]!;
    expect(lead.passed_filter).toBe(true);
    expect(lead.rejection_reasons).toEqual([]);
    expect(lead.tags).not.toContain("rejected:rating-too-low");
    expect(lead.tags).toContain("profile:a");
    expect(lead.first_seen_run_id).toBe(firstSeenRunId);
    expect(lead.last_seen_run_id).toBe(run2Id);
  });

  it("flip passed→rejected: flips passed_filter, adds rejection tags, preserves normal tags", async () => {
    const candidate = makeCandidate(makePlaceId());

    // First insert as passed
    await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [] }],
      run1Id,
      "a",
      tagsFn
    );

    // Now re-discover as rejected
    const { updated } = await upsertLeads(
      [{ candidate, passed: false, rejection_reasons: ["has-real-website"] }],
      run2Id,
      "a",
      tagsFn
    );
    expect(updated).toHaveLength(1);
    const lead = updated[0]!;
    expect(lead.passed_filter).toBe(false);
    expect(lead.rejection_reasons).toEqual(["has-real-website"]);
    expect(lead.tags).toContain("rejected:has-real-website");
    // normal tags are preserved (not cleared)
    expect(lead.tags).toContain("profile:a");
  });

  it("first_seen_run_id is preserved across all flip scenarios", async () => {
    const candidate = makeCandidate(makePlaceId());

    const { inserted } = await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [] }],
      run1Id,
      "a",
      tagsFn
    );
    const originalFirstSeen = inserted[0]!.first_seen_run_id;

    for (let i = 0; i < 2; i++) {
      const passed = i % 2 === 0;
      const { updated } = await upsertLeads(
        [{ candidate, passed, rejection_reasons: passed ? [] : ["rating-too-low"] }],
        run2Id,
        "a",
        tagsFn
      );
      expect(updated[0]!.first_seen_run_id).toBe(originalFirstSeen);
    }
  });

  it("rating and review_count are refreshed on update regardless of flip", async () => {
    const candidate = makeCandidate(makePlaceId());

    await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [] }],
      run1Id,
      "a",
      tagsFn
    );

    const updatedCandidate: PlaceCandidate = {
      ...candidate,
      rating: 4.8,
      userRatingCount: 55,
    };

    const { updated } = await upsertLeads(
      [{ candidate: updatedCandidate, passed: false, rejection_reasons: ["reviews-above-max"] }],
      run2Id,
      "a",
      tagsFn
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]!.rating).toBe(4.8);
    expect(updated[0]!.review_count).toBe(55);
  });

  it("updates niche when a lead is re-discovered under another niche", async () => {
    const candidate = makeCandidate(makePlaceId());

    const { inserted } = await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [], niche: "hairdresser" }],
      run1Id,
      "a",
      tagsFn
    );
    expect(inserted[0]!.niche).toBe("hairdresser");

    const { updated } = await upsertLeads(
      [{ candidate, passed: true, rejection_reasons: [], niche: "car_dealer" }],
      run2Id,
      "a",
      tagsFn
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]!.niche).toBe("car_dealer");
  });
});
