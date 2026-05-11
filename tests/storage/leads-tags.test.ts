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

  it("removes heuristic social tags when confirmed social tags are added", () => {
    const tags = cleanupMergedTagsForEnrichment([
      "profile:a",
      "fb-heuristic",
      "ig-heuristic",
      "fb-confirmed",
      "ig-confirmed",
    ]);

    expect(tags).toContain("fb-confirmed");
    expect(tags).toContain("ig-confirmed");
    expect(tags).not.toContain("fb-heuristic");
    expect(tags).not.toContain("ig-heuristic");
  });

  it("removes stale confirmed social tags and additional phones when current social search does not confirm them", () => {
    const tags = cleanupMergedTagsForEnrichment(
      [
        "profile:a",
        "fb-confirmed",
        "ig-confirmed",
        "additional-phones",
      ],
      {
        skipped: true,
        reason: "no-website",
        fetched_at: "2026-01-01T00:00:00.000Z",
        social_search: {
          ran_at: "2026-01-01T00:00:00.000Z",
          source: "duckduckgo",
          facebook: {
            query: 'site:facebook.com "Business" montevideo',
            results: [],
            best_url: null,
            additional_phones: [],
            confidence: 0,
          },
          instagram: {
            query: 'site:instagram.com "Business" montevideo',
            results: [],
            best_url: null,
            additional_phones: [],
            confidence: 0,
          },
        },
      }
    );

    expect(tags).toEqual(["profile:a"]);
  });

  it("cleans heuristic and missing WhatsApp tags when Playwright confirms social and WhatsApp", () => {
    const tags = cleanupMergedTagsForEnrichment(
      [
        "profile:a",
        "fb-heuristic",
        "ig-heuristic",
        "whatsapp-missing",
        "fb-confirmed",
        "ig-confirmed",
        "whatsapp-confirmed",
      ],
      {
        fetched_at: "2026-01-01T00:00:00.000Z",
        social_search: {
          ran_at: "2026-01-01T00:00:00.000Z",
          source: "playwright",
          facebook: {
            url: "https://facebook.com/business",
            name: "Business",
            email: null,
            phone: "+59898365592",
            website: "https://business.uy",
            description: "About",
            whatsapp_button: true,
            confidence: 0.95,
            signals: ["page_loaded", "name_match", "phone_found"],
          },
          instagram: {
            url: "https://instagram.com/business",
            name: "Business",
            bio: "Bio",
            email: null,
            phone: null,
            external_url: "https://business.uy",
            has_contact_button: false,
            confidence: 0.8,
            signals: ["page_loaded", "bio_extracted"],
          },
        },
      }
    );

    expect(tags).toContain("fb-confirmed");
    expect(tags).toContain("ig-confirmed");
    expect(tags).toContain("whatsapp-confirmed");
    expect(tags).not.toContain("fb-heuristic");
    expect(tags).not.toContain("ig-heuristic");
    expect(tags).not.toContain("whatsapp-missing");
  });
});
