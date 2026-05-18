import type { HeuristicSignal, Lead } from "../../../src/shared/types.js";

function base(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "fixture-id",
    place_id: "fixture-place",
    source: "google_places",
    external_id: "fixture-place",
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    name: "Test Business",
    address: null,
    rating: null,
    review_count: null,
    website: null,
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
    scoring_version: null,
    contact_ready: null,
    prospect_score_v1: null,
    score_breakdown: null,
    score_breakdown_v1: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
    ...overrides,
  };
}

// Profile A fully enriched.
// Expected: bq=50 (rating_excellent:25 + reviews_medium:15 + business_operational:10)
//           dg=55 (no_website:35 + pixel_missing:5 + analytics_missing:5 + whatsapp_missing:10)
//           prospect=floor(50*55/100)=floor(27.5)=27
export const profileA_full = base({
  place_id: "fixture-profile-a-full",
  name: "Peluquería La Paloma",
  rating: 4.7,
  review_count: 35,
  business_status: "OPERATIONAL",
  tags: ["profile:a", "no-website", "pixel-missing", "analytics-missing", "whatsapp-missing"],
  google_data: {}, // photos_count/has_hours/has_recent_reviews absent — Fase 5 TODO
});

// Profile A, discovery tags only (no enrichment).
// Expected: bq=43 (rating_excellent:25 + reviews_low:8 + business_operational:10)
//           dg=35 (no_website:35 only)
//           prospect=floor(43*35/100)=floor(15.05)=15
export const profileA_no_enrichment = base({
  place_id: "fixture-profile-a-no-enrich",
  name: "Kiosco Sin Enrichment",
  rating: 4.5,
  review_count: 20,
  business_status: "OPERATIONAL",
  tags: ["profile:a", "no-website"],
  google_data: null,
});

// Profile B — many reviews, no web, no enrichment.
// Expected: bq=50 (rating_good:15 + reviews_high:25 + business_operational:10)
//           dg=35 (no_website:35)
//           prospect=floor(50*35/100)=floor(17.5)=17
export const profileB_rich = base({
  place_id: "fixture-profile-b-rich",
  name: "Ferretería Central",
  rating: 4.2,
  review_count: 250,
  business_status: "OPERATIONAL",
  tags: ["profile:b", "no-website", "high-reviews-no-web"],
  google_data: null,
});

// Only fb-only-presence tag.
// Expected: bq=0, dg=25 (fb_only:25), prospect=0
export const with_fb_only = base({
  place_id: "fixture-fb-only",
  name: "FB Only Business",
  tags: ["fb-only-presence"],
});

// Both no-website and fb-only-presence — mutual exclusion applies.
// Expected: bq=0, dg=35 (no_website wins: 35 > 25), prospect=0
// Breakdown: digital_gap.rules has only no_website (fb_only excluded)
export const with_fb_and_no_website = base({
  place_id: "fixture-fb-and-no-website",
  name: "FB And No Website",
  tags: ["no-website", "fb-only-presence"],
});

export const with_website_heuristic_and_no_website = base({
  place_id: "fixture-website-heuristic-and-no-website",
  name: "Website Heuristic And No Website",
  tags: ["no-website", "website-heuristic"],
  digital_footprint: {
    heuristic_discovery: {
      ran_at: "2024-01-01T00:00:00Z",
      mode: "website-only" as const,
      stale: false,
      candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
      selected: {
        website: {
          kind: "website" as const,
          url: "https://example.com.uy",
          score: 0.8,
          signals: ["http-ok", "name-match"] as HeuristicSignal[],
          status: "probed" as const,
        },
        facebook: null,
        instagram: null,
        whatsapp: null,
      },
    },
  } as unknown as Lead["digital_footprint"],
});

export const with_social_heuristics = base({
  place_id: "fixture-social-heuristics",
  name: "Social Heuristic Business",
  tags: ["fb-heuristic", "ig-heuristic"],
});

// Site unreachable — no no-website tag (lead HAS a website, just broken).
// Verified invariant: enrichment/index.ts returns skipped("no-website") before fetch,
// so site-unreachable cannot co-tag with no-website. ssl-missing also cannot co-tag
// with site-unreachable because the fetch_error branch never sets footprint.ssl.
// Expected: bq=0, dg=15 (site_unreachable:15 only), prospect=0
export const site_unreachable = base({
  place_id: "fixture-site-unreachable",
  name: "Broken Website Business",
  website: "https://broken.example",
  tags: ["site-unreachable"],
});

// Empty lead — no rating, no reviews, no tags.
// Expected: bq=0, dg=0, prospect=0
export const empty_lead = base({
  place_id: "fixture-empty",
  name: "Empty Lead",
});
