import { describe, expect, it } from "vitest";
import { cleanupMergedTagsForEnrichment } from "../../src/storage/leads.js";

describe("enrichment tag cleanup", () => {
  it("removes absence tags when heuristic tags are added", () => {
    const tags = cleanupMergedTagsForEnrichment([
      "profile:a",
      "no-website",
      "fb-only-presence",
      "ig-only-presence",
      "whatsapp-missing",
      "website-heuristic",
      "fb-heuristic",
      "ig-heuristic",
      "whatsapp-derived",
    ]);

    expect(tags).toContain("profile:a");
    expect(tags).toContain("website-heuristic");
    expect(tags).toContain("fb-heuristic");
    expect(tags).toContain("ig-heuristic");
    expect(tags).toContain("whatsapp-derived");
    expect(tags).not.toContain("no-website");
    expect(tags).not.toContain("fb-only-presence");
    expect(tags).not.toContain("ig-only-presence");
    expect(tags).not.toContain("whatsapp-missing");
  });

  it("removes heuristic-stale when current heuristic discovery is not stale", () => {
    const tags = cleanupMergedTagsForEnrichment(
      ["profile:a", "heuristic-stale", "whatsapp-derived"],
      {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: {
          ran_at: "2026-01-01T00:00:00.000Z",
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: { website: null, facebook: null, instagram: null, whatsapp: null },
        },
      }
    );

    expect(tags).not.toContain("heuristic-stale");
    expect(tags).not.toContain("whatsapp-derived");
  });

  it("removes stale heuristic source tags when current discovery does not select them", () => {
    const tags = cleanupMergedTagsForEnrichment(
      [
        "profile:a",
        "website-heuristic",
        "fb-heuristic",
        "ig-heuristic",
        "whatsapp-derived",
      ],
      {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: {
          ran_at: "2026-01-01T00:00:00.000Z",
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: { website: null, facebook: null, instagram: null, whatsapp: null },
        },
      }
    );

    expect(tags).toEqual(["profile:a"]);
  });
});
