export type LeadState = "discovered" | "contacted" | "qualified" | "disqualified";
export type RunStatus = "running" | "completed" | "failed";
export type DiscoveryProfile = "a" | "b";

export type WebRequirement = "social_or_missing" | "missing_only" | "any";
export type RejectionReason =
  | "rating-too-low"
  | "reviews-below-min"
  | "reviews-above-max"
  | "has-real-website";

export interface ProfileConfig {
  description?: string;
  min_rating: number;
  min_reviews: number;
  max_reviews: number | null;
  web_requirement: WebRequirement;
}

export interface DiscoveryConfig {
  version: 1;
  profiles: Record<string, ProfileConfig>;
  social_domains: string[];
  persist_rejected: boolean;
}

export interface FilterResult {
  passed: PlaceCandidate[];
  rejected: Array<{ candidate: PlaceCandidate; reasons: RejectionReason[] }>;
}

export interface RunStats {
  places_requests: number;
  estimated_cost_usd: number;
  leads_discovered: number;
  leads_new: number;
  leads_updated: number;
  leads_rejected?: number;
  duration_ms: number;
  error?: string;
}

export interface ProspectEntry {
  place_id: string;
  name: string;
  prospect_score: number;
}

export interface ScoringRunStats {
  command: "score";
  scope: "run" | "all";
  source_run_id?: string;
  dry_run: boolean;
  leads_scored: number;
  duration_ms: number;
  top_5: ProspectEntry[];
  bottom_5: ProspectEntry[];
  error?: string;
}

export interface EnrichmentRunStats extends RunStats {
  command: "enrich";
  source_run_id: string;
  leads_processed: number;
  skipped_no_website: number;
  skipped_social_only: number;
  skipped_cache_hit: number;
  fetched_ok: number;
  fetched_error: number;
  whois_errors: number;
}

export type HeuristicDiscoveryMode = "website-only" | "full";
export type HeuristicSourceKind = "website" | "facebook" | "instagram" | "whatsapp";
export type HeuristicSignal =
  | "http-ok"
  | "name-match"
  | "name_in_schema"
  | "city-match"
  | "slug_match"
  | "name_in_bio"
  | "phone_match"
  | "phone_in_schema"
  | "city_match"
  | "cross_ref_from_web"
  | "uy-mobile-phone";

export interface HeuristicCandidate {
  kind: Exclude<HeuristicSourceKind, "whatsapp">;
  url: string;
  score: number;
  signals: HeuristicSignal[];
  status: "probed" | "unprobed";
  http_status?: number | null;
  final_url?: string | null;
  error?: string;
}

export interface HeuristicWhatsappCandidate {
  kind: "whatsapp";
  number: string;
  url: string;
  score: number;
  signals: HeuristicSignal[];
}

export interface HeuristicDiscovery {
  ran_at: string;
  mode: HeuristicDiscoveryMode;
  stale: boolean;
  candidates: {
    website: HeuristicCandidate[];
    facebook: HeuristicCandidate[];
    instagram: HeuristicCandidate[];
    whatsapp: HeuristicWhatsappCandidate[];
  };
  selected: {
    website: HeuristicCandidate | null;
    facebook: HeuristicCandidate | null;
    instagram: HeuristicCandidate | null;
    whatsapp: HeuristicWhatsappCandidate | null;
  };
}

export type DirectorySignal =
  | "phone_match"
  | "address_match"
  | "name_match"
  | "directory_website";

export interface DirectoryCandidate {
  directory_url: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  confidence: number;
  signals: DirectorySignal[];
}

export interface DirectoryDiscovery {
  ran_at: string;
  /** Directory source hostname, currently known sources include "yelu.uy". */
  source: string;
  query: string;
  candidates: DirectoryCandidate[];
  best_website: string | null;
  error?: string;
}

export type SocialSearchPlatform = "facebook" | "instagram";
export type SocialSearchSignal =
  | "name_in_title"
  | "name_in_snippet"
  | "city_in_snippet"
  | "phone_in_snippet"
  | "url_matches_platform";
export type PlaywrightSocialSignal =
  | "page_loaded"
  | "name_match"
  | "email_found"
  | "phone_found"
  | "website_found"
  | "description_found"
  | "whatsapp_button"
  | "bio_extracted"
  | "external_url_found"
  | "contact_button";

export interface SocialSearchResult {
  url: string;
  title: string;
  snippet: string;
  score: number;
  signals: SocialSearchSignal[];
  phones_found: string[];
}

export interface SocialSearchPlatformResult {
  query: string;
  results: SocialSearchResult[];
  best_url: string | null;
  additional_phones: string[];
  confidence: number;
  error?: string;
}

export interface DuckDuckGoSocialSearch {
  ran_at: string;
  source: "duckduckgo";
  facebook: SocialSearchPlatformResult;
  instagram: SocialSearchPlatformResult;
}

export interface PlaywrightFacebookSearchResult {
  url: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  whatsapp_button: boolean;
  confidence: number;
  signals: PlaywrightSocialSignal[];
}

export interface PlaywrightInstagramSearchResult {
  url: string;
  name: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  external_url: string | null;
  has_contact_button: boolean;
  confidence: number;
  signals: PlaywrightSocialSignal[];
}

export interface PlaywrightSocialSearch {
  ran_at: string;
  source: "playwright";
  facebook: PlaywrightFacebookSearchResult | null;
  instagram: PlaywrightInstagramSearchResult | null;
}

export type SocialSearch = DuckDuckGoSocialSearch | PlaywrightSocialSearch;

export interface OperationalSystemsSignal {
  booking_platforms: string[];
  reservation_platforms: string[];
  delivery_platforms: string[];
  menu_links: string[];
  menu_keywords: string[];
  class_booking_platforms: string[];
  app_store_links: string[];
  catalog_keywords: string[];
  contact_form: boolean;
  chat_widget: boolean;
}

export type DigitalFootprintSkipped = {
  skipped: true;
  reason: "no-website" | "social-only";
  fetched_at: string;
  contact_emails?: string[];
  heuristic_discovery?: HeuristicDiscovery;
  directory_discovery?: DirectoryDiscovery;
  social_search?: SocialSearch;
};

export interface DigitalFootprintEnriched {
  skipped?: false;
  fetched_at: string;
  heuristic_discovery?: HeuristicDiscovery;
  directory_discovery?: DirectoryDiscovery;
  social_search?: SocialSearch;
  fetch_error?: string;
  attempted_url?: string;
  final_url?: string;
  http_status?: number;
  ssl?: { valid_https: boolean; cert_valid: boolean | null };
  pixels?: {
    meta_pixel: { present: boolean; id: string | null };
    ga4: { present: boolean; id: string | null };
    ga_universal: { present: boolean; id: string | null };
    gtm: { present: boolean; id: string | null };
  };
  stack?:
    | { name: string; version: string | null; confidence: "high" | "medium" | "low" }
    | null;
  viewport?: { present: boolean; content: string | null };
  whatsapp?: {
    present: boolean;
    numbers: string[];
    source: "link" | "button-heuristic" | null;
  };
  social_links?: {
    facebook: string | null;
    instagram: string | null;
    tiktok: string | null;
    count: number;
  };
  copyright_year?: number | null;
  operational_systems?: OperationalSystemsSignal;
  contact_emails?: string[];
  phone_confirmed?: boolean;
  phone_alternatives?: string[];
  has_hours_on_web?: boolean;
  whois?: {
    fetched_at: string;
    created_at: string | null;
    registrar: string | null;
    expires_at: string | null;
    age_years: number | null;
    error?: string;
  };
}

export type DigitalFootprint = DigitalFootprintSkipped | DigitalFootprintEnriched;

export interface Run {
  id: string;
  niche: string;
  location: string;
  profile: DiscoveryProfile;
  config: Record<string, unknown>;
  stats: RunStats | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
}

export interface Lead {
  id: string;
  place_id: string;
  niche: string | null;
  name: string;
  address: string | null;
  rating: number | null;
  review_count: number | null;
  website: string | null;
  whatsapp: string | null;
  phone: string | null;
  business_status: string | null;
  tags: string[];
  notes: string | null;
  state: LeadState;
  first_seen_run_id: string | null;
  last_seen_run_id: string | null;
  google_data: Record<string, unknown> | null;
  digital_footprint: DigitalFootprint | null;
  reviews_sample: unknown[] | null;
  business_quality_score: number | null;
  digital_gap_score: number | null;
  systems_gap_score: number | null;
  prospect_score: number | null;
  passed_filter: boolean;
  rejection_reasons: string[];
  score_breakdown: Record<string, unknown> | null;
  systems_gap_breakdown: Record<string, unknown> | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadUpsert {
  candidate: PlaceCandidate;
  passed: boolean;
  rejection_reasons: string[];
  niche?: string;
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  websiteUri: string | null;
  phone: string | null;
  businessStatus: string | null;
  primaryType: string | null;
  raw: Record<string, unknown>;
}

export interface DiscoverOptions {
  niche: string;
  location: string;
  profile: DiscoveryProfile;
  maxResults: number;
  minRating: number;
}

export interface RunSummary {
  runId: string;
  discovered: number;
  filtered: number;
  createdNew: number;
  alreadyExisted: number;
}
