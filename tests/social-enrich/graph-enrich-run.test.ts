import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
  loadLeadsByRunId: vi.fn(),
  updateLeadSocialSearch: vi.fn(),
  updateLeadSocialEnrichStatus: vi.fn(),
}));

vi.mock("../../src/modules/social-enrich/graph-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/social-enrich/graph-api.js")>();
  return {
    ...actual, // conservar extractUsernameFromUrl real
    isGraphApiEnabled: vi.fn(() => true),
    lookupInstagramBusiness: vi.fn(),
  };
});

import { runInstagramGraphEnrich } from "../../src/modules/social-enrich/graph-enrich.js";
import { loadAllLeads, loadLeadsByRunId, updateLeadSocialSearch, updateLeadSocialEnrichStatus } from "../../src/storage/leads.js";
import { isGraphApiEnabled, lookupInstagramBusiness, type GraphLookupResult } from "../../src/modules/social-enrich/graph-api.js";

function leadWithIg(id: string, username: string): Lead {
  return {
    id, place_id: `p-${id}`, niche: "panaderia", name: id, address: "Montevideo",
    rating: null, review_count: null, website: null, whatsapp: null, phone: null,
    business_status: null, tags: [], notes: null, state: "discovered",
    first_seen_run_id: "r1", last_seen_run_id: "r1", google_data: null,
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00Z",
      heuristic_discovery: {
        ran_at: "2026-01-01T00:00:00Z", mode: "full", stale: false,
        candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
        selected: {
          website: null, facebook: null, whatsapp: null,
          instagram: { kind: "instagram", url: `https://instagram.com/${username}`, score: 0.8, signals: ["name-match"], status: "probed" },
        },
      },
    } as unknown as Lead["digital_footprint"],
    reviews_sample: null, business_quality_score: null, digital_gap_score: null,
    systems_gap_score: null, prospect_score: null, passed_filter: true,
    rejection_reasons: [], score_breakdown: null, systems_gap_breakdown: null,
    contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

function okResult(): GraphLookupResult {
  return {
    status: "ok",
    profile: {
      username: "x", name: "X", biography: "Pan. 099123456", followers_count: 3200,
      follows_count: 100, media_count: 200, website: null,
      recent_media: [{ caption: "h", timestamp: "2026-06-01T00:00:00Z", like_count: 10, comments_count: 1 }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isGraphApiEnabled).mockReturnValue(true);
  vi.mocked(updateLeadSocialSearch).mockResolvedValue(undefined);
  vi.mocked(updateLeadSocialEnrichStatus).mockResolvedValue(undefined as never);
});

describe("runInstagramGraphEnrich", () => {
  it("lanza error si la fuente está inactiva (sin token)", async () => {
    vi.mocked(isGraphApiEnabled).mockReturnValue(false);
    await expect(runInstagramGraphEnrich({ all: true })).rejects.toThrow(/META_IG_USER_ID|inactiv/i);
  });

  it("enriquece cuentas profesionales y cuenta los estados (medición de la primera corrida)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      leadWithIg("pro", "cuenta_pro"),
      leadWithIg("personal", "cuenta_personal"),
      leadWithIg("inexistente", "no_existe"),
    ]);
    vi.mocked(lookupInstagramBusiness)
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce({ status: "not_professional" })
      .mockResolvedValueOnce({ status: "not_found" });

    const stats = await runInstagramGraphEnrich({ all: true, nowIso: "2026-06-09T00:00:00Z" });

    expect(stats.enriched).toBe(1);
    expect(stats.not_professional).toBe(1);
    expect(stats.not_found).toBe(1);
    expect(updateLeadSocialSearch).toHaveBeenCalledTimes(1);
    expect(updateLeadSocialSearch).toHaveBeenCalledWith(
      "pro",
      expect.objectContaining({ source: "playwright", instagram: expect.objectContaining({ liveness: expect.objectContaining({ state: "alive" }) }) }),
      expect.arrayContaining(["ig-confirmed"]),
      null,
      expect.anything(),
      expect.anything()
    );
  });

  it("aborta el run ante auth_error (token roto), sin seguir consultando", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([leadWithIg("a", "uno"), leadWithIg("b", "dos")]);
    vi.mocked(lookupInstagramBusiness).mockResolvedValue({ status: "auth_error", message: "token expirado" });

    await expect(runInstagramGraphEnrich({ all: true })).rejects.toThrow(/token|auth/i);
    expect(lookupInstagramBusiness).toHaveBeenCalledTimes(1); // cortó en el primero
  });

  it("rate_limited hace backoff y reintenta una vez", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([leadWithIg("a", "uno")]);
    vi.mocked(lookupInstagramBusiness)
      .mockResolvedValueOnce({ status: "rate_limited" })
      .mockResolvedValueOnce(okResult());
    const sleep = vi.fn(async () => undefined);

    const stats = await runInstagramGraphEnrich({ all: true, sleepFn: sleep, nowIso: "2026-06-09T00:00:00Z" });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(stats.enriched).toBe(1);
  });

  it("saltea leads sin URL de IG utilizable", async () => {
    const noIg = leadWithIg("noig", "x");
    (noIg.digital_footprint as { heuristic_discovery: { selected: { instagram: unknown } } }).heuristic_discovery.selected.instagram = null;
    vi.mocked(loadLeadsByRunId).mockResolvedValue([noIg]);

    const stats = await runInstagramGraphEnrich({ run: "11111111-2222-3333-4444-555555555555" });

    expect(stats.selected).toBe(0);
    expect(lookupInstagramBusiness).not.toHaveBeenCalled();
  });
});
