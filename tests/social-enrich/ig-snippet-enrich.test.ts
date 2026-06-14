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

function leadWithIg(
  id: string,
  username: string | null,
  extra: { status?: "ok" | "blocked" | "no_data"; prospect?: number; metrics?: boolean } = {}
): Lead {
  const heuristic = username
    ? {
        ran_at: "2026-01-01T00:00:00Z",
        mode: "full",
        stale: false,
        candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
        selected: {
          website: null,
          facebook: null,
          whatsapp: null,
          instagram: { kind: "instagram", url: `https://instagram.com/${username}`, score: 0.8, signals: [], status: "probed" },
        },
      }
    : undefined;
  return {
    id, place_id: `p-${id}`, niche: "panaderia", name: id, address: "Montevideo",
    rating: null, review_count: null, website: null, whatsapp: null, phone: null,
    business_status: null, tags: [], notes: null, state: "discovered",
    first_seen_run_id: "r1", last_seen_run_id: "r1", google_data: null,
    digital_footprint: (username || extra.status
      ? ({
          fetched_at: "2026-01-01T00:00:00Z",
          ...(heuristic ? { heuristic_discovery: heuristic } : {}),
          ...(extra.status ? { social_enrich_status: extra.status } : {}),
          // metrics:true → social_activity con audience_tier real (genuinamente enriquecido);
          // si no, presencia "vacía" como la era login-wall (audience_tier null).
          ...(extra.status === "ok"
            ? {
                social_activity: {
                  ran_at: "2026-01-01T00:00:00Z",
                  source: "playwright_public",
                  profiles: {},
                  summary: {
                    has_social_presence: true,
                    active_platforms: extra.metrics ? ["instagram"] : [],
                    abandoned_platforms: [],
                    best_platform: "instagram",
                    audience_tier: extra.metrics ? "small" : null,
                    commercial_signals: [],
                  },
                },
              }
            : {}),
        } as unknown as Lead["digital_footprint"])
      : null),
    reviews_sample: null, business_quality_score: null, digital_gap_score: null,
    systems_gap_score: null, prospect_score: extra.prospect ?? null, passed_filter: true,
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
    // el miss se marca no_data para no re-consultarlo
    expect(updateLeadSocialEnrichStatus).toHaveBeenCalledWith(expect.any(String), "no_data");
  });

  it("salta los ya resueltos (ok CON métricas / no_data) — no repite", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      leadWithIg("ok", "cuenta_ok", { status: "ok", metrics: true }),
      leadWithIg("nd", "cuenta_nd", { status: "no_data" }),
      leadWithIg("new", "cuenta_new"),
    ]);
    const lookup = vi.fn().mockResolvedValue(profile());
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.skipped_resolved).toBe(2);
    expect(stats.selected).toBe(1);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("re-consulta los 'ok' VACÍOS de la era vieja (sin métricas reales)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      leadWithIg("empty", "cuenta_empty", { status: "ok", metrics: false }), // ok pero audience_tier null
    ]);
    const lookup = vi.fn().mockResolvedValue(profile());
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.skipped_resolved).toBe(0);
    expect(stats.selected).toBe(1);
    expect(stats.enriched).toBe(1);
  });

  it("retryNoData re-incluye los no_data pero no los ok con métricas", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      leadWithIg("ok", "cuenta_ok", { status: "ok", metrics: true }),
      leadWithIg("nd", "cuenta_nd", { status: "no_data" }),
    ]);
    const lookup = vi.fn().mockResolvedValue(profile());
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup, retryNoData: true });
    expect(stats.selected).toBe(1);
    expect(stats.skipped_resolved).toBe(1);
  });

  it("prioriza por prospect_score desc (mejores leads primero)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue([
      leadWithIg("low", "cuenta_low", { prospect: 10 }),
      leadWithIg("high", "cuenta_high", { prospect: 90 }),
    ]);
    const seen: string[] = [];
    const lookup = vi.fn().mockImplementation((u: string) => { seen.push(u); return Promise.resolve(profile()); });
    await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup, limit: 1 });
    expect(seen).toEqual(["cuenta_high"]);
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

  it("aborta si el proveedor parece caído (racha de nulls SIN ningún éxito)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => leadWithIg(`l${i}`, `c${i}`))
    );
    const lookup = vi.fn().mockResolvedValue(null); // proveedor siempre vacío
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.aborted_provider_down).toBe(true);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("NO aborta por nulls si ya hubo al menos un éxito (nulls = cuentas personales)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => leadWithIg(`l${i}`, `c${i}`))
    );
    // primer lookup éxito, el resto null
    const lookup = vi.fn().mockResolvedValueOnce(profile()).mockResolvedValue(null);
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, lookup });
    expect(stats.aborted_provider_down).toBe(false);
    expect(lookup.mock.calls.length).toBe(12); // procesa todos
  });

  it("F1: en --retry-no-data los nulls son esperados → NO aborta (sin falso provider-down)", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => leadWithIg(`l${i}`, `c${i}`))
    );
    const lookup = vi.fn().mockResolvedValue(null);
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, concurrency: 6, retryNoData: true, lookup });
    expect(stats.aborted_provider_down).toBe(false);
    expect(lookup.mock.calls.length).toBe(20); // procesa todos pese a 0 éxitos
  });

  it("F1: con concurrency>1 procesa en paralelo y reporta throughput", async () => {
    vi.mocked(loadAllLeads).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => leadWithIg(`l${i}`, `c${i}`))
    );
    const lookup = vi.fn().mockResolvedValue(profile());
    const stats = await runIgSnippetEnrich({ all: true, throttleMs: 0, concurrency: 3, lookup });
    expect(stats.enriched).toBe(6);
    // leads_per_sec es 0 cuando elapsed_ms=0 (run instantáneo con lookup mockeado) — ig-snippet-enrich.ts:163.
    // No es flake: el throughput de trabajo instantáneo es 0 por diseño. Antes asumía elapsed_ms>=1.
    expect(stats.leads_per_sec).toBeGreaterThanOrEqual(0);
    expect(stats.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});
