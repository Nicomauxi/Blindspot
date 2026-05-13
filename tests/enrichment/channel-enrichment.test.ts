import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/config.js", () => ({
  getConfig: vi.fn(() => ({
    HEURISTIC_REFRESH_DAYS: 30,
    DIRECTORY_REFRESH_DAYS: 30,
    SOCIAL_SEARCH_REFRESH_DAYS: 30,
  })),
}));

import { enrichLead } from "../../src/modules/enrichment/index.js";
import type {
  DirectoryDiscovery,
  HeuristicDiscovery,
  HeuristicDiscoveryMode,
  Lead,
  SocialSearch,
} from "../../src/shared/types.js";

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    place_id: "ChIJfake",
    name: "Test Lead",
    address: "Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: "099 111 222",
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function emptyDirectory(): DirectoryDiscovery {
  return {
    ran_at: new Date().toISOString(),
    source: "paginasamarillas.com.uy",
    query: "test-lead montevideo",
    candidates: [],
    best_website: null,
  };
}

function heuristicResult(mode: HeuristicDiscoveryMode): HeuristicDiscovery {
  return {
    ran_at: new Date().toISOString(),
    mode,
    stale: false,
    candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
    selected: { website: null, facebook: null, instagram: null, whatsapp: null },
  };
}

function emptySocialSearch(): SocialSearch {
  return {
    ran_at: new Date().toISOString(),
    source: "duckduckgo",
    facebook: {
      query: 'site:facebook.com "Test Lead" montevideo',
      results: [],
      best_url: null,
      additional_phones: [],
      confidence: 0,
    },
    instagram: {
      query: 'site:instagram.com "Test Lead" montevideo',
      results: [],
      best_url: null,
      additional_phones: [],
      confidence: 0,
    },
  };
}

describe("partial channel enrichment", () => {
  it("lead with fb-confirmed + ig-confirmed: heuristicDiscover called with skipChannels.facebook and skipChannels.instagram true", async () => {
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode)
    );
    const lead = makeLead({
      website: null,
      tags: ["fb-confirmed", "ig-confirmed"],
    });

    await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover: vi.fn(async () => emptyDirectory()),
      socialSearchDiscover: vi.fn(async () => emptySocialSearch()),
    });

    expect(heuristicDiscover).toHaveBeenCalledOnce();
    expect(heuristicDiscover).toHaveBeenCalledWith(
      lead,
      "full",
      expect.any(Object),
      expect.objectContaining({
        skipChannels: expect.objectContaining({
          facebook: true,
          instagram: true,
        }),
      })
    );
    const opts = (heuristicDiscover.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    const skip = opts["skipChannels"] as Record<string, boolean>;
    expect(skip["facebook"]).toBe(true);
    expect(skip["instagram"]).toBe(true);
    expect(skip["whatsapp"]).toBe(false);
  });

  it("lead with all channels confirmed (social website + website-heuristic high score): heuristicDiscover NOT called", async () => {
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode)
    );
    // Lead has social website but a previously confirmed heuristic website (score 0.9)
    // and all social channels confirmed by Playwright.
    const lead = makeLead({
      website: "https://www.facebook.com/myshop",
      tags: ["website-heuristic", "fb-confirmed", "ig-confirmed", "whatsapp-confirmed"],
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: {
          ran_at: "2026-01-01T00:00:00.000Z",
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: {
            website: {
              kind: "website",
              url: "https://myshop.com.uy",
              score: 0.9,
              signals: ["http-ok", "name-match"],
              status: "probed",
            },
            facebook: null,
            instagram: null,
            whatsapp: null,
          },
        },
      },
    });

    await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover: vi.fn(async () => emptyDirectory()),
      socialSearchDiscover: vi.fn(async () => emptySocialSearch()),
    });

    expect(heuristicDiscover).not.toHaveBeenCalled();
  });

  it("fresh lead with no tags: heuristicDiscover called with mode full and no skipChannels (same behavior as before)", async () => {
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode)
    );
    const lead = makeLead({ website: null, tags: [] });

    await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover: vi.fn(async () => emptyDirectory()),
      socialSearchDiscover: vi.fn(async () => emptySocialSearch()),
    });

    expect(heuristicDiscover).toHaveBeenCalledOnce();
    expect(heuristicDiscover).toHaveBeenCalledWith(
      lead,
      "full",
      expect.any(Object),
      { additionalWebsiteUrls: [] }
    );
  });
});
