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
  extractProfileUrl,
  handleMatchesName,
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

describe("extractProfileUrl (perfil vs contenido)", () => {
  it("normaliza un perfil de IG a su forma canónica", () => {
    expect(extractProfileUrl("https://instagram.com/clearbarberia", "instagram")).toBe("https://www.instagram.com/clearbarberia/");
    expect(extractProfileUrl("https://www.instagram.com/la_pasiva_uy/reels/", "instagram")).toBe("https://www.instagram.com/la_pasiva_uy/");
  });
  it("descarta posts/reels/explore de IG (contenido, no perfil)", () => {
    expect(extractProfileUrl("https://www.instagram.com/p/CaARe7kFZgn/", "instagram")).toBeNull();
    expect(extractProfileUrl("https://www.instagram.com/reel/DWhl/", "instagram")).toBeNull();
    expect(extractProfileUrl("https://www.instagram.com/explore/locations/123/x/", "instagram")).toBeNull();
  });
  it("FB: perfil/página sí, contenido no", () => {
    expect(extractProfileUrl("https://www.facebook.com/MiNegocioUy/", "facebook")).toBe("https://www.facebook.com/MiNegocioUy/");
    expect(extractProfileUrl("https://www.facebook.com/profile.php?id=100012345", "facebook")).toBe("https://www.facebook.com/profile.php?id=100012345");
    expect(extractProfileUrl("https://www.facebook.com/watch/?v=999", "facebook")).toBeNull();
    expect(extractProfileUrl("https://www.facebook.com/MiNegocio/posts/123", "facebook")).toBe("https://www.facebook.com/MiNegocio/");
  });
});

describe("handleMatchesName (rescate de engines sin snippet)", () => {
  it("matchea handle ≈ nombre del negocio", () => {
    expect(handleMatchesName("https://www.instagram.com/clearbarberia/", "CLEAR barberia")).toBe(true);
    expect(handleMatchesName("https://www.instagram.com/barberia_black_jack_uruguay/", "Barberia Black jack")).toBe(true);
  });
  it("rechaza handles que no se parecen", () => {
    expect(handleMatchesName("https://www.instagram.com/otracosa/", "CLEAR barberia")).toBe(false);
    expect(handleMatchesName("https://www.instagram.com/ab/", "AB")).toBe(false); // muy corto
  });
});

describe("discoverSocialViaSearxng", () => {
  it("rescata un perfil de IG por handle aunque el engine no traiga snippet (caso yandex)", async () => {
    const deps: SocialDiscoverDeps = {
      // yandex: URL correcta pero título/contenido vacíos.
      search: vi.fn(async (q: string) =>
        q.includes("instagram")
          ? [{ url: "https://www.instagram.com/clearbarberia/", title: "Link to instagram.com", content: "The site owner hides the web page description." }]
          : []
      ),
      delay: async () => {},
    };
    const res = await discoverSocialViaSearxng({ name: "CLEAR barberia", address: "Montevideo" }, deps);
    expect(res.instagram.best_url).toBe("https://www.instagram.com/clearbarberia/");
  });

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
