import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enrichLead } from "../../src/modules/enrichment/index.js";
import type {
  DirectoryDiscovery,
  HeuristicDiscovery,
  HeuristicDiscoveryMode,
  Lead,
} from "../../src/shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    place_id: "ChIJfake",
    name: "Test Lead",
    address: null,
    rating: null,
    review_count: null,
    website: "https://example.com",
    whatsapp: null,
    phone: null,
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
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function fetchHtmlOk(htmlBody: string, finalUrl = "https://example.com/") {
  return vi.fn(async () => ({
    status: 200,
    finalUrl,
    html: htmlBody,
    headers: { "content-type": "text/html; charset=utf-8" },
    fetchedAt: new Date().toISOString(),
  }));
}

function fetchHtmlError() {
  return vi.fn(async () => ({
    status: null,
    finalUrl: null,
    html: null,
    headers: {},
    fetchedAt: new Date().toISOString(),
    error: "network: ECONNREFUSED",
  }));
}

function whoisOk(ageYears: number | null) {
  return vi.fn(async () => ({
    fetched_at: new Date().toISOString(),
    created_at: ageYears !== null ? new Date(Date.now() - ageYears * 365.25 * 86400 * 1000).toISOString() : null,
    registrar: "Test Registrar",
    expires_at: null,
    age_years: ageYears,
  }));
}

function directoryResult(bestWebsite: string | null): DirectoryDiscovery {
  return {
    ran_at: new Date().toISOString(),
    source: "paginasamarillas.com.uy",
    query: "test-lead montevideo",
    candidates: [],
    best_website: bestWebsite,
  };
}

function heuristicResult(mode: HeuristicDiscoveryMode, websiteUrl: string | null): HeuristicDiscovery {
  return {
    ran_at: new Date().toISOString(),
    mode,
    stale: false,
    candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
    selected: {
      website: websiteUrl
        ? {
            kind: "website",
            url: websiteUrl,
            score: 0.9,
            signals: ["http-ok", "name-match"],
            status: "probed",
            http_status: 200,
            final_url: websiteUrl,
          }
        : null,
      facebook: null,
      instagram: null,
      whatsapp: null,
    },
  };
}

describe("enrichLead", () => {
  it("returns skipped no-website when website is null", async () => {
    const lead = makeLead({ website: null });
    const r = await enrichLead(lead, { forceRefresh: false });
    expect(r.outcome).toBe("skipped-no-website");
    expect(r.tags_to_add).toEqual([]);
    expect(r.digital_footprint).toMatchObject({ skipped: true, reason: "no-website" });
  });

  it("returns skipped social-only when website is a social link", async () => {
    const lead = makeLead({ website: "https://www.facebook.com/myshop" });
    const r = await enrichLead(lead, { forceRefresh: false });
    expect(r.outcome).toBe("skipped-social");
    expect(r.tags_to_add).toEqual([]);
    expect(r.digital_footprint).toMatchObject({ skipped: true, reason: "social-only" });
  });

  it("website real does not call heuristic discovery", async () => {
    const heuristicDiscover = vi.fn(async () => heuristicResult("full", null));
    const lead = makeLead({ website: "https://example.com" });
    await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      fetchHtml: fetchHtmlOk(loadFixture("plain-static.html")),
      whoisLookup: whoisOk(null),
      heuristicDiscover,
    });
    expect(heuristicDiscover).not.toHaveBeenCalled();
  });

  it("website social calls heuristic in website-only mode", async () => {
    const directoryDiscover = vi.fn(async () => directoryResult(null));
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode, "https://example.com")
    );
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"));
    const lead = makeLead({ website: "https://www.facebook.com/myshop" });
    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(null),
      heuristicDiscover,
      directoryDiscover,
    });
    expect(directoryDiscover).toHaveBeenCalledWith(lead, expect.any(Object));
    expect(heuristicDiscover).toHaveBeenCalledWith(
      lead,
      "website-only",
      expect.any(Object),
      { additionalWebsiteUrls: [] }
    );
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com");
    expect(r.tags_to_add).toContain("website-heuristic");
    expect((r.digital_footprint as { heuristic_discovery?: HeuristicDiscovery }).heuristic_discovery?.mode).toBe("website-only");
  });

  it("passes directory best website into heuristic before scraping", async () => {
    const directoryDiscover = vi.fn(async () => directoryResult("https://violet.com.uy"));
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode, "https://violet.com.uy")
    );
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"), "https://violet.com.uy/");
    const lead = makeLead({
      website: null,
      name: "Violet Peluquería",
      address: "Hocquart 2049, Montevideo, Uruguay",
    });

    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(null),
      heuristicDiscover,
      directoryDiscover,
    });

    expect(heuristicDiscover).toHaveBeenCalledWith(
      lead,
      "full",
      expect.any(Object),
      { additionalWebsiteUrls: ["https://violet.com.uy"] }
    );
    expect(fetchSpy).toHaveBeenCalledWith("https://violet.com.uy");
    expect(r.digital_footprint).toMatchObject({
      directory_discovery: { best_website: "https://violet.com.uy" },
      heuristic_discovery: { selected: { website: { url: "https://violet.com.uy" } } },
    });
  });

  it("website null calls heuristic in full mode", async () => {
    const directoryDiscover = vi.fn(async () => directoryResult(null));
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicResult(mode, null)
    );
    const lead = makeLead({ website: null });
    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover,
    });
    expect(heuristicDiscover).toHaveBeenCalledWith(
      lead,
      "full",
      expect.any(Object),
      { additionalWebsiteUrls: [] }
    );
    expect(r.outcome).toBe("skipped-no-website");
    expect(r.digital_footprint).toMatchObject({
      skipped: true,
      reason: "no-website",
      heuristic_discovery: { mode: "full" },
    });
  });

  it("does not emit heuristic-stale for a recent heuristic discovery", async () => {
    const recent = new Date().toISOString();
    const lead = makeLead({
      website: null,
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: recent,
        heuristic_discovery: {
          ran_at: recent,
          mode: "full",
          stale: false,
          candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
          selected: {
            website: null,
            facebook: null,
            instagram: null,
            whatsapp: {
              kind: "whatsapp",
              number: "+59899123456",
              url: "https://wa.me/59899123456",
              score: 1,
              signals: ["uy-mobile-phone"],
            },
          },
        },
      },
    });
    const heuristicDiscover = vi.fn(async () => heuristicResult("full", null));
    const directoryDiscover = vi.fn(async () => directoryResult(null));

    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover,
    });

    expect(heuristicDiscover).not.toHaveBeenCalled();
    expect(r.tags_to_add).toContain("whatsapp-derived");
    expect(r.tags_to_add).not.toContain("heuristic-stale");
  });

  it("does not emit fb/ig heuristic tags when social candidates have no verified signals", async () => {
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode): Promise<HeuristicDiscovery> => ({
      ran_at: new Date().toISOString(),
      mode,
      stale: false,
      candidates: {
        website: [],
        facebook: [
          {
            kind: "facebook",
            url: "https://www.facebook.com/test-lead",
            score: 0,
            signals: [],
            status: "probed",
            http_status: 403,
            final_url: "https://www.facebook.com/test-lead",
            error: "http-403",
          },
        ],
        instagram: [
          {
            kind: "instagram",
            url: "https://www.instagram.com/test-lead",
            score: 0,
            signals: [],
            status: "probed",
            http_status: 403,
            final_url: "https://www.instagram.com/test-lead",
            error: "http-403",
          },
        ],
        whatsapp: [],
      },
      selected: {
        website: null,
        facebook: null,
        instagram: null,
        whatsapp: null,
      },
    }));
    const lead = makeLead({ website: null });
    const directoryDiscover = vi.fn(async () => directoryResult(null));

    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      heuristicDiscover,
      directoryDiscover,
    });

    expect(r.outcome).toBe("skipped-no-website");
    expect(r.tags_to_add).not.toContain("fb-heuristic");
    expect(r.tags_to_add).not.toContain("ig-heuristic");
  });

  it("emits site-unreachable tag when fetch fails after retries", async () => {
    const lead = makeLead({ website: "https://example.com" });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlError(),
      whoisLookup: whoisOk(null),
    });
    expect(r.outcome).toBe("fetched-error");
    expect(r.tags_to_add).toContain("site-unreachable");
    const fp = r.digital_footprint;
    expect((fp as { fetch_error?: string }).fetch_error).toBeTruthy();
  });

  it("emits pixel-missing + analytics-missing on plain HTML without trackers", async () => {
    const lead = makeLead({
      website: "https://example.com",
      phone: "+59899111222",  // mobile heuristic — should suppress whatsapp-missing
    });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(loadFixture("plain-static.html")),
      whoisLookup: whoisOk(2.0),
    });
    expect(r.outcome).toBe("fetched-ok");
    expect(r.tags_to_add).toContain("pixel-missing");
    expect(r.tags_to_add).toContain("analytics-missing");
    expect(r.tags_to_add).toContain("not-responsive");
    expect(r.tags_to_add).not.toContain("whatsapp-missing");
    expect(r.tags_to_add).not.toContain("domain-old-stale");
  });

  it("persists operational system signals from scraped HTML", async () => {
    const lead = makeLead({ website: "https://example.com" });
    const html = `
      <html><body>
        <a href="https://booksy.com/es-uy/test">Reservar</a>
        <a href="/menu-carta.pdf">Ver carta</a>
        <form class="contact-form"><input name="cotizar"></form>
      </body></html>
    `;
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(html),
      whoisLookup: whoisOk(null),
    });
    expect(r.outcome).toBe("fetched-ok");
    expect(r.digital_footprint).toMatchObject({
      operational_systems: {
        booking_platforms: ["booksy.com"],
        menu_links: ["/menu-carta.pdf"],
        contact_form: true,
      },
    });
  });

  it("emits whatsapp-missing when no whatsapp signals AND lead.phone lacks mobile shape", async () => {
    const lead = makeLead({ website: "https://example.com", phone: null });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(loadFixture("plain-static.html")),
      whoisLookup: whoisOk(null),
    });
    expect(r.tags_to_add).toContain("whatsapp-missing");
  });

  it("emits domain-old-stale when whois age > 5 years", async () => {
    const lead = makeLead({ website: "https://example.com" });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(loadFixture("squarespace-clean.html")),
      whoisLookup: whoisOk(7.5),
    });
    expect(r.tags_to_add).toContain("domain-old-stale");
  });

  it("emits stack-obsolete on WordPress version < 5", async () => {
    const lead = makeLead({ website: "https://example.com", phone: "+59899111222" });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(loadFixture("wordpress-pixel.html")),
      whoisLookup: whoisOk(3.0),
    });
    expect(r.tags_to_add).toContain("stack-obsolete");
    // wordpress-pixel.html has Meta Pixel + viewport + wa.me link
    expect(r.tags_to_add).not.toContain("pixel-missing");
    expect(r.tags_to_add).not.toContain("not-responsive");
    expect(r.tags_to_add).not.toContain("whatsapp-missing");
    expect(r.whatsapp_from_site).toBe("59899123456");
  });

  it("uses cached HTML when fetched_at is recent and forceRefresh is false", async () => {
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"));
    const recent = new Date(Date.now() - 1000).toISOString();
    const lead = makeLead({
      website: "https://example.com",
      digital_footprint: {
        fetched_at: recent,
        ssl: { valid_https: true, cert_valid: null },
        pixels: {
          meta_pixel: { present: true, id: "X" },
          ga4: { present: false, id: null },
          ga_universal: { present: false, id: null },
          gtm: { present: false, id: null },
        },
        viewport: { present: true, content: "width=device-width" },
        whatsapp: { present: true, numbers: ["59899111111"], source: "link" },
        social_links: { facebook: null, instagram: null, tiktok: null, count: 0 },
        whois: {
          fetched_at: recent,
          created_at: null,
          registrar: null,
          expires_at: null,
          age_years: 2.0,
        },
        stack: null,
      },
    });
    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(2.0),
    });
    expect(r.outcome).toBe("cache-hit");
    expect(fetchSpy).not.toHaveBeenCalled();
    // Tags re-emitted idempotently from cached footprint
    expect(r.tags_to_add).toContain("analytics-missing");
  });

  it("ignores cache when forceRefresh is true", async () => {
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"));
    const recent = new Date(Date.now() - 1000).toISOString();
    const lead = makeLead({
      website: "https://example.com",
      digital_footprint: {
        fetched_at: recent,
        viewport: { present: true, content: "width=device-width" },
      },
    });
    const r = await enrichLead(lead, { forceRefresh: true }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(null),
    });
    expect(r.outcome).toBe("fetched-ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
