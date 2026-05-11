import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/shared/config.js", () => ({
  getConfig: vi.fn(() => ({
    HEURISTIC_REFRESH_DAYS: 30,
    DIRECTORY_REFRESH_DAYS: 30,
    SOCIAL_SEARCH_REFRESH_DAYS: 30,
  })),
}));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enrichLead } from "../../src/modules/enrichment/index.js";
import type {
  DirectoryDiscovery,
  HeuristicDiscovery,
  HeuristicDiscoveryMode,
  Lead,
  SocialSearch,
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

function heuristicSocialResult(mode: HeuristicDiscoveryMode, platform: "facebook" | "instagram"): HeuristicDiscovery {
  const result = heuristicResult(mode, null);
  result.selected[platform] = {
    kind: platform,
    url: `https://www.${platform}.com/test-lead`,
    score: 0.85,
    signals: ["slug_match", "name_in_bio"],
    status: "probed",
    http_status: 200,
    final_url: `https://www.${platform}.com/test-lead`,
  };
  return result;
}

function socialSearchResult(overrides: Partial<SocialSearch> = {}): SocialSearch {
  return {
    ran_at: new Date().toISOString(),
    source: "duckduckgo",
    facebook: {
      query: 'site:facebook.com "Test Lead" montevideo',
      results: [
        {
          url: "https://facebook.com/test-lead",
          title: "Test Lead | Montevideo",
          snippet: "Test Lead Montevideo 098365592",
          score: 1.1,
          signals: [
            "name_in_title",
            "name_in_snippet",
            "city_in_snippet",
            "phone_in_snippet",
            "url_matches_platform",
          ],
          phones_found: ["+59898365592"],
        },
      ],
      best_url: "https://facebook.com/test-lead",
      additional_phones: ["+59898365592"],
      confidence: 1.1,
    },
    instagram: {
      query: 'site:instagram.com "Test Lead" montevideo',
      results: [],
      best_url: null,
      additional_phones: [],
      confidence: 0,
    },
    ...overrides,
  };
}

function emptySocialSearchResult(): SocialSearch {
  return socialSearchResult({
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
  });
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
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

  it("uses fresh cached heuristic website without running heuristic discovery", async () => {
    const cached = heuristicResult("full", "https://cached.example.com");
    const lead = makeLead({
      website: null,
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: new Date().toISOString(),
        heuristic_discovery: cached,
      },
    });
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"), "https://cached.example.com/");
    const heuristicDiscover = vi.fn(async () => heuristicResult("full", null));
    const directoryDiscover = vi.fn(async () => directoryResult(null));

    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(null),
      heuristicDiscover,
      directoryDiscover,
    });

    expect(r.outcome).toBe("fetched-ok");
    expect(fetchSpy).toHaveBeenCalledWith("https://cached.example.com");
    expect(heuristicDiscover).not.toHaveBeenCalled();
    expect(directoryDiscover).not.toHaveBeenCalled();
    expect(r.tags_to_add).toContain("website-heuristic");
  });

  it("does not use stale cached heuristic website without heuristic discovery", async () => {
    const cached = { ...heuristicResult("full", "https://stale.example.com"), stale: true };
    const lead = makeLead({
      website: null,
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: new Date().toISOString(),
        heuristic_discovery: cached,
      },
    });
    const fetchSpy = fetchHtmlOk(loadFixture("plain-static.html"), "https://stale.example.com/");

    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchSpy,
      whoisLookup: whoisOk(null),
    });

    expect(r.outcome).toBe("skipped-no-website");
    expect(fetchSpy).not.toHaveBeenCalled();
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
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
      socialSearchDiscover: vi.fn(async () => emptySocialSearchResult()),
    });

    expect(r.outcome).toBe("skipped-no-website");
    expect(r.tags_to_add).not.toContain("fb-heuristic");
    expect(r.tags_to_add).not.toContain("ig-heuristic");
  });

  it("runs social search after heuristic social discovery and persists confirmed tags", async () => {
    const directoryDiscover = vi.fn(async () => directoryResult(null));
    const heuristicDiscover = vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
      heuristicSocialResult(mode, "facebook")
    );
    const socialSearchDiscover = vi.fn(async () => socialSearchResult());
    const lead = makeLead({ website: null, address: "Hocquart 2049, Montevideo, Uruguay" });

    const r = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      directoryDiscover,
      heuristicDiscover,
      socialSearchDiscover,
    });

    expect(socialSearchDiscover).toHaveBeenCalledWith(lead);
    expect(r.digital_footprint).toMatchObject({
      skipped: true,
      reason: "no-website",
      social_search: { facebook: { best_url: "https://facebook.com/test-lead" } },
    });
    expect(r.tags_to_add).toEqual(expect.arrayContaining([
      "fb-heuristic",
      "fb-confirmed",
      "additional-phones",
      "whatsapp-derived",
    ]));
    expect(r.whatsapp_from_site).toBe("+59898365592");
  });

  it("runs social search for no-website leads with whatsapp-missing and no heuristic flag", async () => {
    const socialSearchDiscover = vi.fn(async () => socialSearchResult());
    const lead = makeLead({ website: null, tags: ["no-website", "whatsapp-missing"] });

    const r = await enrichLead(lead, { forceRefresh: false }, { socialSearchDiscover });

    expect(socialSearchDiscover).toHaveBeenCalledWith(lead);
    expect(r.outcome).toBe("skipped-no-website");
    expect(r.tags_to_add).toContain("fb-confirmed");
    expect(r.tags_to_add).toContain("whatsapp-derived");
  });

  it("reuses fresh cached social search unless withHeuristic forces rerun", async () => {
    const cached = socialSearchResult();
    const lead = makeLead({
      website: null,
      tags: ["no-website", "whatsapp-missing"],
      digital_footprint: {
        skipped: true,
        reason: "no-website",
        fetched_at: new Date().toISOString(),
        social_search: cached,
      },
    });
    const socialSearchDiscover = vi.fn(async () => socialSearchResult({
      facebook: {
        ...cached.facebook,
        best_url: "https://facebook.com/fresh",
        confidence: 0.8,
      },
    }));

    const cachedRun = await enrichLead(lead, { forceRefresh: false }, { socialSearchDiscover });
    expect(socialSearchDiscover).not.toHaveBeenCalled();
    expect(cachedRun.digital_footprint).toMatchObject({
      social_search: { facebook: { best_url: "https://facebook.com/test-lead" } },
    });

    const forcedRun = await enrichLead(lead, { forceRefresh: false, withHeuristic: true }, {
      directoryDiscover: vi.fn(async () => directoryResult(null)),
      heuristicDiscover: vi.fn(async (_lead: Lead, mode: HeuristicDiscoveryMode) =>
        heuristicResult(mode, null)
      ),
      socialSearchDiscover,
    });
    expect(socialSearchDiscover).toHaveBeenCalledTimes(1);
    expect(forcedRun.digital_footprint).toMatchObject({
      social_search: { facebook: { best_url: "https://facebook.com/fresh" } },
    });
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

  it("persists web contact signals and emits positive tags after successful scrape", async () => {
    const lead = makeLead({ website: "https://example.com", phone: "+59899123456" });
    const html = `
      <html><head>
        <script src="https://embed.tawk.to/site/default"></script>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"LocalBusiness","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","opens":"09:00","closes":"18:00"}]}
        </script>
      </head><body>
        <a href="mailto:ventas@negocio.uy">Email</a>
        <a href="tel:099123456">Llamar</a>
      </body></html>
    `;

    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(html),
      whoisLookup: whoisOk(null),
    });

    expect(r.digital_footprint).toMatchObject({
      contact_emails: ["ventas@negocio.uy"],
      phone_confirmed: true,
      phone_alternatives: [],
      has_hours_on_web: true,
      operational_systems: { chat_widget: true },
    });
    expect(r.tags_to_add).toEqual(expect.arrayContaining([
      "email-found",
      "phone-web-confirmed",
      "chat-widget",
    ]));
    expect(r.tags_to_add).not.toContain("email-missing");
    expect(r.tags_to_add).not.toContain("hours-missing-on-web");
    expect(r.tags_to_add).not.toContain("chat-widget-missing");
  });

  it("emits absence tags for new web signals only after successful scrape", async () => {
    const lead = makeLead({ website: "https://example.com", phone: "+59899111222" });

    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk("<html><body><p>Bienvenidos</p></body></html>"),
      whoisLookup: whoisOk(null),
    });

    expect(r.digital_footprint).toMatchObject({
      contact_emails: [],
      phone_confirmed: false,
      phone_alternatives: [],
      has_hours_on_web: false,
      operational_systems: { chat_widget: false },
    });
    expect(r.tags_to_add).toEqual(expect.arrayContaining([
      "email-missing",
      "chat-widget-missing",
      "hours-missing-on-web",
    ]));
  });

  it("persists copyright year and emits web-outdated tag", async () => {
    const lead = makeLead({ website: "https://example.com" });
    const html = "<html><body><footer>Copyright 2020 Test Lead</footer></body></html>";

    const r = await enrichLead(lead, { forceRefresh: false }, {
      fetchHtml: fetchHtmlOk(html),
      whoisLookup: whoisOk(null),
    });

    expect(r.digital_footprint).toMatchObject({ copyright_year: 2020 });
    expect(r.tags_to_add).toContain("web-outdated");
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
    expect(r.whatsapp_from_site).toBe("+59899123456");
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
    expect(r.tags_to_add).not.toContain("email-missing");
    expect(r.tags_to_add).not.toContain("chat-widget-missing");
    expect(r.tags_to_add).not.toContain("hours-missing-on-web");
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
