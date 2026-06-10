export type LeadState = "discovered" | "contacted" | "qualified" | "disqualified";
export type RunStatus = "running" | "completed" | "failed";
export type DiscoveryProfile = "a" | "b" | "c" | "d";

export type WebRequirement = "social_or_missing" | "missing_only" | "any";
export type RejectionReason =
  | "rating-too-low"
  | "reviews-below-min"
  | "reviews-above-max"
  | "has-real-website"
  | "geo-out-of-bounds";

export interface ProfileConfig {
  description?: string | undefined;
  min_rating: number;
  min_reviews: number;
  max_reviews: number | null;
  web_requirement: WebRequirement;
}

export interface ScrapingConfig {
  discovery_ua_pool: string[];
  discovery_delay_ms: [number, number];
  discovery_max_retries: number;
  social_ua_pool: string[];
  social_delay_ms: [number, number];
  social_max_retries: number;
  proxy_enabled: boolean;
}

export interface DiscoveryConfig {
  version: 1;
  profiles: Record<string, ProfileConfig>;
  social_domains: string[];
  persist_rejected: boolean;
  source_refresh?: Record<string, number> | undefined;
  deduplication?: {
    geo_radius_meters?: number | undefined;
    name_threshold_online?: number | undefined;
    name_threshold_retroactive?: number | undefined;
  } | undefined;
  scraping?: ScrapingConfig | undefined;
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
  warnings?: string[];
  error?: string;
}

export interface EnrichmentRunStats extends RunStats {
  command: "enrich";
  source_run_id?: string;
  leads_processed: number;
  significant_changes: number;
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
  | "redirect-mismatch"
  | "foreign-com-penalty"
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
  // Estado de "vida" de la red (FB/IG): si la página realmente existe y es funcional.
  liveness?: import("../modules/social-enrich/liveness.js").Liveness;
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

export interface EnrichmentChange {
  field: string;
  from: unknown;
  to: unknown;
  significance: "critical" | "high" | "low";
}

export interface EnrichmentDiff {
  lead_id: string;
  changed_at: string;
  changes: EnrichmentChange[];
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
  source: "duckduckgo" | "duckduckgo-fallback";
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
  liveness?: import("../modules/social-enrich/liveness.js").Liveness;
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
  liveness?: import("../modules/social-enrich/liveness.js").Liveness;
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
  ecommerce_platforms: string[];
  whatsapp_web_link: boolean;
}

export type DigitalFootprintSkipped = {
  skipped: true;
  reason: "no-website" | "social-only";
  fetched_at: string;
  contact_emails?: string[];
  heuristic_discovery?: HeuristicDiscovery;
  directory_discovery?: DirectoryDiscovery;
  social_search?: SocialSearch;
  social_activity?: import("../modules/social-enrich/social-activity.js").SocialActivitySnapshot;
  social_enrich_status?: "ok" | "blocked";
  last_change_diff?: EnrichmentDiff;
};

export interface InferredStateField {
  value: boolean;
  confidence: number;
  via: string[];
}

export interface InferredState {
  has_reservations:     InferredStateField;
  has_delivery:         InferredStateField;
  has_online_catalog:   InferredStateField;
  has_ecommerce:        InferredStateField;
  has_pos:              InferredStateField;
  has_chat_support:     InferredStateField;
  digitalization_level: "none" | "basic" | "intermediate" | "advanced";
  computed_at:          string;
}

export type EmailQualityKind = "generic" | "role" | "personal" | "unknown";

export interface EmailQualityAssessment {
  email: string;
  quality: EmailQualityKind;
  domain_match: boolean;
  mx_valid: boolean | null;
  reliability_multiplier: number;
}

export type PhoneContactType = "mobile" | "landline" | "unknown";

export interface PhoneContactAssessment {
  phone: string;
  normalized: string | null;
  type: PhoneContactType;
  region: "montevideo" | "interior" | null;
}

export interface DigitalFootprintEnriched {
  skipped?: false;
  fetched_at: string;
  heuristic_discovery?: HeuristicDiscovery;
  directory_discovery?: DirectoryDiscovery;
  social_search?: SocialSearch;
  social_activity?: import("../modules/social-enrich/social-activity.js").SocialActivitySnapshot;
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
  email_quality?: EmailQualityAssessment[];
  phone_confirmed?: boolean;
  phone_alternatives?: string[];
  phone_classification?: PhoneContactAssessment[];
  has_hours_on_web?: boolean;
  whois?: {
    fetched_at: string;
    created_at: string | null;
    registrar: string | null;
    expires_at: string | null;
    age_years: number | null;
    error?: string;
  };
  inferred_state?: InferredState;
  social_enrich_status?: "ok" | "blocked";
  last_change_diff?: EnrichmentDiff;
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
  source: DiscoverySource;
  external_id: string | null;
  source_confidence: number | null;
  source_data: Record<string, unknown> | null;
  data_confidence_score: number | null;
  contact_reliability_score: number | null;
  canonical_fields: Record<string, unknown> | null;
  corroborating_sources: CorroboratingSource[];
  canonical_source: string | null;
  owner_group_id: string | null;
  lead_company_data: LeadCompanyData | null;
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
  inferred_state: InferredState | null;
  gps: unknown | null;
  reviews_sample: unknown[] | null;
  business_quality_score: number | null;
  digital_gap_score: number | null;
  systems_gap_score: number | null;
  prospect_score: number | null;
  scoring_version: number | null;
  contact_ready: boolean | null;
  prospect_score_v1: number | null;
  passed_filter: boolean;
  rejection_reasons: string[];
  score_breakdown: Record<string, unknown> | null;
  score_breakdown_v1: Record<string, unknown> | null;
  systems_gap_breakdown: Record<string, unknown> | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadDashboardRecord {
  id: string;
  name: string;
  niche: string | null;
  source: string;
  canonical_source: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  tags: string[];
  state: LeadState;
  business_status: string | null;
  source_confidence: number | null;
  data_confidence_score: number | null;
  contact_reliability_score: number | null;
  contact_ready: boolean | null;
  prospect_score: number | null;
  contact_tier: string | null;
  primary_offer: string | null;
  pitch_hook: string | null;
  urgency_signal: string | null;
  contacted_at: string | null;
  contacted_by: string | null;
  created_at: string;
  corroborating_sources: CorroboratingSource[];
  top_buyer_type: string | null;
  top_buyer_score: number | null;
  owner_group_id: string | null;
}

export interface LeadDetailRecord extends LeadDashboardRecord {
  notes: string | null;
  digital_footprint: DigitalFootprint | Record<string, unknown> | null;
  inferred_state: InferredState | Record<string, unknown> | null;
  score_breakdown: Record<string, unknown> | null;
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
  lat: number | null;
  lng: number | null;
  geo_suspect: boolean;
  departamento: string | null;
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

export interface LeadCompanyData {
  rut?: string;
  razon_social?: string;
  nombre_comercial?: string;
  ciiu?: string;
  tamano_empresa?: string;
  registro_mintur?: string;
  habilitacion_imm?: string;
  fecha_fundacion?: string;
  detected_sub_niche?: string;
  sub_niche_source?: "keyword" | "llm";
  sub_niche_detected_at?: string;
  tipo_operador?: string;
  tipo_operador_sub_niche?: string;
}

// ─── Multi-source architecture ────────────────────────────────────────────────

export type DiscoverySource =
  | "google_places"
  | "mintur"
  | "pedidosya"
  | "imm_habilitaciones"
  | "yelu"
  | "osm"
  | "infonegocios"
  | "dgi"
  | "miem_dei"
  // Fuentes derivadas del scraping de la propia red social descubierta (descripción/bio).
  // Su confianza es dinámica (ver social-source-confidence.ts), no un valor fijo.
  | "social_facebook"
  | "social_instagram";

export interface DiscoveryQuery {
  niche: string;
  location: string;
  maxResults?: number;
}

export interface DiscoveryCandidate {
  source: DiscoverySource;
  external_id: string;
  source_confidence: number;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  niche: string | null;
  raw: Record<string, unknown>;
}

export interface IDiscoveryProvider {
  readonly source: DiscoverySource;
  readonly sourceConfidence: number;
  discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]>;
}

export interface CorroboratingSource {
  source: DiscoverySource;
  external_id?: string;
  seen_at: string;
  confidence: number;
}

export interface FieldEvidence {
  value: string;
  sources: CorroboratingSource[];
  first_seen: string;
  last_seen: string;
  confidence: number;
}
