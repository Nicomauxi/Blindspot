import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
  loadLeadsByRunId: vi.fn(),
  updateLeadSocialSearch: vi.fn(),
  updateLeadSocialEnrichStatus: vi.fn(),
}));

import { runIgSnippetEnrich } from "../../src/modules/social-enrich/ig-snippet-enrich.js";
import { loadAllLeads, updateLeadSocialSearch, updateLeadSocialEnrichStatus } from "../../src/storage/leads.js";
import type { SocialProfileData } from "../../src/modules/social-enrich/social-fusion.js";

function leadWithIg(id: string, username: string | null): Lead {
  return {
    id, place_id: `p-${id}`, niche: "panaderia", name: id, address: "Montevideo",
    rating: null, review_count: null, website: null, whatsapp: null, phone: null,
    business_status: null, tags: [], notes: null, state: "discovered",
    first_seen_run_id: "r1", last_seen_run_id: "r1", google_data: null,
    digital_footprint: username ? ({
      fetched_at: "2026-01-01T00:00:00Z",
      heuristic_discovery: {
        ran_at: "2026-01-01T00:00:00Z", mode: "full", stale: false,
        candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
        selected: { website: null, facebook: null, whatsapp: null,
          instagram: { kind: "instagram", url: `https://instagram.com/${username}`, score: 0.8, signals: [], status: "probed" } },
      },
    } as unknown as Lead["digital_footprint"]) : null,
    reviews_sample: null, business_quality_score: null, digital_gap_score: null,
    systems_gap_score: null, prospect_score: null, passed_filter: true,
    rejection_reasons: [], score_breakdown: null, systems_gap_breakdown: null,
    contacted_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

function profile(): SocialProfileData {
  return { username: "x", name: null, biography: "Pan. 099123456", followers_count: 3200, follows_count: 100, media_count: 200, website: null, recent_media: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateLeadSocialSearch).mockResolvedValue(undefined);
  vi.mocked(updateLeadSocialEnrichStatus).mockResolvedValue(undefined as never);
});

describe("runIgSnippetEnrich", () => {
  it("enriquece leads con snippet y cuenta los que no tienen", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([leadWithIg("a", "cuenta_a"), leadWithIg("b", "cuenta_b")]);
    const lookup = vi.fn()
      .mockResolvedValueOnce(profile())
      .mockResolvedValueOnce(null);
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup, nowIso: "2026-06-10T00:00:00Z" });
    expect(stats.enriched).toBe(1);
    expect(stats.no_snippet).toBe(1);
    expect(updateLeadSocialSearch).toHaveBeenCalledTimes(1);
  });

  it("un lead sin IG seleccionada no es candidato (no entra al loop)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([leadWithIg("a", null)]);
    const lookup = vi.fn();
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.selected).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("candidato con URL de IG inválida (post /p/) → skipped_no_url, sin consultar", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([leadWithIg("post", "p/Cabc123")]);
    const lookup = vi.fn();
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.selected).toBe(1);
    expect(stats.skipped_no_url).toBe(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("aborta si DDG bloquea (nulls consecutivos)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => leadWithIg(`l${i}`, `c${i}`))
    );
    const lookup = vi.fn().mockResolvedValue(null); // siempre bloqueado
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.aborted_anti_bot).toBe(true);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(6); // cortó en la racha
  });
});
