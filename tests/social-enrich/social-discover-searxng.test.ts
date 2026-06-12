import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllLeads: vi.fn(),
  loadLeadsByRunId: vi.fn(),
  updateLeadSocialSearch: vi.fn(),
}));

import { runSocialDiscovery } from "../../src/modules/social-enrich/social-discover-run.js";
import {
  discoverSocialViaSearxng,
  type SocialDiscoverDeps,
} from "../../src/modules/social-enrich/social-discover-searxng.js";
import { isDiscoverCandidate } from "../../src/modules/social-enrich/social-discover-run.js";
import { loadAllLeads, updateLeadSocialSearch } from "../../src/storage/leads.js";

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id, place_id: `p-${id}`, name: id, address: "Montevideo", niche: "restaurant",
    rating: null, review_count: null, website: null, whatsapp: null, phone: null,
    business_status: null, tags: [], notes: null, state: "discovered",
    passed_filter: true, first_seen_run_id: "r", last_seen_run_id: "r",
    digital_footprint: null, ...over,
  } as unknown as Lead;
}

describe("isDiscoverCandidate", () => {
  it("acepta lead del pool sin web real ni IG seleccionada", () => {
    expect(isDiscoverCandidate(lead("a"))).toBe(true);
  });
  it("rechaza lead con web real", () => {
    expect(isDiscoverCandidate(lead("b", { website: "https://negocio.com.uy" }))).toBe(false);
  });
  it("acepta lead cuyo 'website' es una red social (no es web real)", () => {
    expect(isDiscoverCandidate(lead("c", { website: "https://instagram.com/x" }))).toBe(true);
  });
  it("rechaza lead fuera del pool", () => {
    expect(isDiscoverCandidate(lead("d", { passed_filter: false }))).toBe(false);
  });
});

describe("discoverSocialViaSearxng", () => {
  it("selecciona el mejor perfil de IG por nombre+ciudad", async () => {
    const deps: SocialDiscoverDeps = {
      search: vi.fn(async (q: string) =>
        q.includes("instagram")
          ? [{ url: "https://instagram.com/lafarmacia", title: "La Farmacia Montevideo", content: "La Farmacia en Montevideo" }]
          : []
      ),
      delay: async () => {},
    };
    const res = await discoverSocialViaSearxng({ name: "La Farmacia", address: "Montevideo" }, deps);
    expect(res.source).toBe("searxng");
    expect(res.instagram.best_url).toContain("instagram.com/lafarmacia");
    expect(res.facebook.best_url).toBeNull();
  });
});

describe("runSocialDiscovery (concurrente + instrumentado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateLeadSocialSearch).mockResolvedValue(undefined);
  });

  it("procesa candidatos en paralelo, persiste hallazgos y reporta throughput", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([lead("alfa"), lead("beta"), lead("gama")]);
    const deps: SocialDiscoverDeps = {
      // El título refleja el nombre del query (buildQuery incluye "<name>") para que
      // scoreResult dispare name_in_title en cada lead.
      search: vi.fn(async (q: string) => {
        if (!q.includes("instagram")) return [];
        const name = q.match(/"([^"]+)"/)?.[1] ?? "";
        return [{ url: "https://instagram.com/x", title: `${name} Montevideo`, content: `${name} en Montevideo` }];
      }),
      delay: async () => {},
    };
    const stats = await runSocialDiscovery({ all: true, concurrency: 3, deps });
    expect(stats.candidates).toBe(3);
    expect(stats.found_instagram).toBe(3);
    expect(stats.leads_per_sec).toBeGreaterThanOrEqual(0);
    expect(updateLeadSocialSearch).toHaveBeenCalledTimes(3);
  });

  it("cuenta no_match cuando no hay perfil", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([lead("1")]);
    const deps: SocialDiscoverDeps = { search: vi.fn(async () => []), delay: async () => {} };
    const stats = await runSocialDiscovery({ all: true, deps });
    expect(stats.no_match).toBe(1);
    expect(stats.found_any).toBe(0);
    expect(updateLeadSocialSearch).not.toHaveBeenCalled();
  });
});
