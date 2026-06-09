import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/shared/config.js", () => ({
  getConfig: vi.fn(() => ({
    HEURISTIC_REFRESH_DAYS: 30,
    DIRECTORY_REFRESH_DAYS: 30,
    SOCIAL_SEARCH_REFRESH_DAYS: 30,
    SOCIAL_ENRICH_CONCURRENCY: 2,
  })),
}));

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
  loadLeadsByRunId: vi.fn(),
  updateLeadSocialSearch: vi.fn(),
  updateLeadSocialEnrichStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/modules/discovery/config.js", () => ({
  getScrapingConfig: vi.fn(() => ({
    social_ua_pool: ["Mozilla/5.0 Test UA"],
    social_delay_ms: [0, 0],
    social_max_retries: 0,
    discovery_ua_pool: ["Mozilla/5.0 Test UA"],
    discovery_delay_ms: [0, 0],
    discovery_max_retries: 0,
    proxy_enabled: false,
  })),
  getSocialSearchRefreshDays: vi.fn(() => 30),
}));

vi.mock("../../src/modules/social-enrich/browser.js", () => ({
  openSocialEnrichBrowser: vi.fn(),
}));

vi.mock("../../src/modules/social-enrich/facebook.js", () => ({
  extractFacebookProfile: vi.fn(),
}));

vi.mock("../../src/modules/social-enrich/instagram.js", () => ({
  extractInstagramProfile: vi.fn(),
}));

import { runSocialEnrich } from "../../src/modules/social-enrich/index.js";
import { openSocialEnrichBrowser } from "../../src/modules/social-enrich/browser.js";
import { extractFacebookProfile } from "../../src/modules/social-enrich/facebook.js";
import { extractInstagramProfile } from "../../src/modules/social-enrich/instagram.js";
import { loadAllLeads, loadLeadsByRunId, updateLeadSocialSearch } from "../../src/storage/leads.js";

const RUN_ID = "94fae3e7-070c-41de-a7c9-3e6875818a83";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: "beauty",
    name: "Salon Bella",
    address: "Montevideo, Uruguay",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: ["fb-heuristic", "ig-heuristic"],
    notes: null,
    state: "discovered",
    first_seen_run_id: RUN_ID,
    last_seen_run_id: RUN_ID,
    google_data: null,
    digital_footprint: {
      skipped: true,
      reason: "no-website",
      fetched_at: "2026-01-01T00:00:00.000Z",
      heuristic_discovery: {
        ran_at: "2026-01-01T00:00:00.000Z",
        mode: "full",
        stale: false,
        candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
        selected: {
          website: null,
          facebook: {
            kind: "facebook",
            url: "https://facebook.com/salonbella",
            score: 0.8,
            signals: ["name-match"],
            status: "probed",
          },
          instagram: {
            kind: "instagram",
            url: "https://instagram.com/salonbella",
            score: 0.8,
            signals: ["name-match"],
            status: "probed",
          },
          whatsapp: null,
        },
      },
    },
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const context = { newPage: vi.fn(async () => ({ close: vi.fn(async () => undefined) })) };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  vi.mocked(openSocialEnrichBrowser).mockResolvedValue({
    browser: browser as unknown as Browser,
    context: context as unknown as BrowserContext,
  });
  vi.mocked(extractFacebookProfile).mockResolvedValue({
    url: "https://facebook.com/salonbella",
    name: "Salon Bella",
    email: "hola@salonbella.uy",
    phone: "+59898365592",
    website: "https://salonbella.uy",
    description: "Belleza",
    whatsapp_button: true,
    confidence: 0.95,
    signals: ["page_loaded", "name_match", "phone_found"],
  });
  vi.mocked(extractInstagramProfile).mockResolvedValue({
    url: "https://instagram.com/salonbella",
    name: "Salon Bella",
    bio: "Belleza",
    email: null,
    phone: null,
    external_url: "https://salonbella.uy",
    has_contact_button: false,
    confidence: 0.8,
    signals: ["page_loaded", "bio_extracted"],
  });
  vi.mocked(updateLeadSocialSearch).mockResolvedValue(undefined);
});

describe("runSocialEnrich", () => {
  it("loads scoped leads, reuses one browser context, persists confirmed tags, and closes browser", async () => {
    const lead = makeLead();
    vi.mocked(loadLeadsByRunId).mockResolvedValue([lead]);

    const result = await runSocialEnrich({ run: RUN_ID, limit: 10, force: false });

    expect(loadLeadsByRunId).toHaveBeenCalledWith(RUN_ID);
    expect(openSocialEnrichBrowser).toHaveBeenCalledTimes(1);
    expect(extractFacebookProfile).toHaveBeenCalledWith(
      expect.anything(),
      "https://facebook.com/salonbella",
      lead
    );
    expect(extractInstagramProfile).toHaveBeenCalledWith(
      expect.anything(),
      "https://instagram.com/salonbella",
      lead
    );
    // Validación posicional de los primeros 5 args; el 6º (socialCanonical) es opcional
    // y varía según lo que parsea de la bio/descripción.
    expect(updateLeadSocialSearch).toHaveBeenCalled();
    const socialCall = vi.mocked(updateLeadSocialSearch).mock.calls[0]!;
    expect(socialCall[0]).toBe("lead-1");
    expect(socialCall[1]).toEqual(
      expect.objectContaining({
        source: "playwright",
        facebook: expect.objectContaining({ confidence: 0.95 }),
        instagram: expect.objectContaining({ confidence: 0.8 }),
      })
    );
    expect(socialCall[2]).toEqual(
      expect.arrayContaining(["fb-confirmed", "ig-confirmed", "whatsapp-derived", "whatsapp-confirmed"])
    );
    expect(socialCall[3]).toBe("+59898365592");
    expect(socialCall[4]).toEqual(
      expect.objectContaining({
        source: "playwright_public",
        profiles: expect.any(Object),
        summary: expect.any(Object),
      })
    );
    expect(result.processed).toBe(1);
    const opened = vi.mocked(openSocialEnrichBrowser).mock.results[0];
    const resolved = await opened?.value;
    expect(resolved?.browser.close).toHaveBeenCalledTimes(1);
  });

  it("uses --all, applies limit, and skips fresh Playwright results unless forced", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      makeLead({
        id: "fresh",
        digital_footprint: {
          fetched_at: "2026-01-01T00:00:00.000Z",
          social_search: {
            ran_at: new Date().toISOString(),
            source: "playwright",
            facebook: null,
            instagram: null,
          },
        },
      }),
      makeLead({ id: "candidate-1" }),
      makeLead({ id: "candidate-2" }),
    ]);

    const result = await runSocialEnrich({ all: true, limit: 1, force: false });

    expect(loadAllLeads).toHaveBeenCalled();
    expect(updateLeadSocialSearch).toHaveBeenCalledTimes(1);
    expect(result.selected).toBe(1);
  });

  it("continues when one lead extraction fails", async () => {
    vi.mocked(loadLeadsByRunId).mockResolvedValue([
      makeLead({ id: "failing" }),
      makeLead({ id: "ok" }),
    ]);
    vi.mocked(extractFacebookProfile)
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(null);

    const result = await runSocialEnrich({ run: RUN_ID, limit: 10, force: true });

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(1);
  });

  it("counts blocked leads separately from errors", async () => {
    vi.mocked(loadLeadsByRunId).mockResolvedValue([
      makeLead({ id: "blocked-lead" }),
      makeLead({ id: "ok-lead" }),
    ]);
    vi.mocked(extractFacebookProfile)
      .mockRejectedValueOnce(new Error("403 blocked"))
      .mockResolvedValueOnce(null);

    const result = await runSocialEnrich({ run: RUN_ID, limit: 10, force: true });

    expect(result.blocked).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.processed).toBe(1);
  });
});
