export type LeadState = "discovered" | "contacted" | "qualified" | "disqualified";
export type RunStatus = "running" | "completed" | "failed";
export type DiscoveryProfile = "a" | "b";

export interface Lead {
  id: string;
  place_id: string;
  name: string;
  formatted_address: string | null;
  rating: number | null;
  user_rating_count: number | null;
  website_uri: string | null;
  phone: string | null;
  business_status: string | null;
  score: number | null;
  tags: string[];
  notes: string | null;
  state: LeadState;
  first_seen_run_id: string | null;
  last_seen_run_id: string | null;
  discovery_profile: string | null;
  raw_place_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  niche: string;
  location: string;
  profile: DiscoveryProfile;
  max_results: number;
  min_rating: number;
  discovered: number;
  filtered: number;
  created_new: number;
  updated_existing: number;
  status: RunStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
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
