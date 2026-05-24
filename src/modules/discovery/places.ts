import { fetch } from "undici";
import { z } from "zod";
import pRetry from "p-retry";
import pLimit from "p-limit";
import { getConfig } from "../../shared/config.js";
import { getLogger } from "../../shared/logger.js";
import { getSubAreas } from "./location-subdivider.js";
import { isWithinUruguay, inferDepartamento } from "./geo-validator.js";
import type { PlaceCandidate } from "../../shared/types.js";

const PLACES_BASE = "https://places.googleapis.com/v1";

export const TEXT_SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.businessStatus",
  "places.primaryType",
  "places.location",
].join(",");

export const DETAILS_FIELDS = "photos,regularOpeningHours,reviews";
export const REFRESH_SUMMARY_FIELDS = [
  "rating",
  "userRatingCount",
  "businessStatus",
  "internationalPhoneNumber",
  "websiteUri",
  "formattedAddress",
  "location",
  "displayName",
].join(",");

// ---- Zod schemas -------------------------------------------------------

const DisplayNameSchema = z.object({
  text: z.string(),
  languageCode: z.string().optional(),
});

const PlaceLocationSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const PlaceItemSchema = z.object({
  id: z.string(),
  displayName: DisplayNameSchema.optional(),
  formattedAddress: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  websiteUri: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  businessStatus: z.string().optional(),
  primaryType: z.string().optional(),
  location: PlaceLocationSchema.optional(),
});

const TextSearchResponseSchema = z.object({
  places: z.array(PlaceItemSchema).default([]),
  nextPageToken: z.string().optional(),
});

const ReviewSchema = z.object({
  name: z.string().optional(),
  publishTime: z.string().optional(),
  relativePublishTimeDescription: z.string().optional(),
  rating: z.number().optional(),
  text: z.object({ text: z.string().optional() }).optional(),
});

const PlaceDetailsSchema = z.object({
  photos: z.array(z.object({ name: z.string() })).optional(),
  regularOpeningHours: z
    .object({ weekdayDescriptions: z.array(z.string()).optional() })
    .optional(),
  reviews: z.array(ReviewSchema).optional(),
});

export type PlaceDetailsResult = z.infer<typeof PlaceDetailsSchema>;

const PlaceSummarySchema = z.object({
  displayName: DisplayNameSchema.optional(),
  formattedAddress: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  websiteUri: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  businessStatus: z.string().optional(),
  location: PlaceLocationSchema.optional(),
});

export type PlaceSummaryResult = z.infer<typeof PlaceSummarySchema>;

// ---- HTTP helpers -------------------------------------------------------

async function placesPost<T>(
  path: string,
  body: Record<string, unknown>,
  fieldMask: string
): Promise<T> {
  const { GOOGLE_PLACES_API_KEY } = getConfig();
  const url = `${PLACES_BASE}/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Places API error ${response.status} on ${path}: ${text}`);
  }
  return response.json() as Promise<T>;
}

async function placesGet<T>(path: string, fieldMask: string): Promise<T> {
  const { GOOGLE_PLACES_API_KEY } = getConfig();
  const url = `${PLACES_BASE}/${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Places API error ${response.status} on ${path}: ${text}`);
  }
  return response.json() as Promise<T>;
}

function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(fn, {
    retries: 3,
    factor: 2,
    minTimeout: 500,
    randomize: true,
    onFailedAttempt: (err) => {
      getLogger().warn(
        { attempt: err.attemptNumber, retriesLeft: err.retriesLeft },
        "Places API request failed, retrying…"
      );
    },
  });
}

// ---- Text Search -------------------------------------------------------

type PlaceItem = z.infer<typeof PlaceItemSchema>;

export interface TextSearchRequestLog {
  request: { query: string; field_mask: string; page_size: number; page_token: string | null };
  response: { place_count: number; next_page_token: string | null; duration_ms: number };
}

export async function textSearch(
  query: string,
  maxResultCount: number,
  opts: { earlyStopDiscardRatio?: number; quickDiscardFn?: (place: PlaceItem) => boolean } = {}
): Promise<{ places: PlaceItem[]; requestCount: number; requestLog: TextSearchRequestLog[] }> {
  const log = getLogger();
  const allPlaces: PlaceItem[] = [];
  const requestLog: TextSearchRequestLog[] = [];
  let pageToken: string | undefined;
  const pageSize = Math.min(maxResultCount, 20);
  let requestCount = 0;

  do {
    const body: Record<string, unknown> = { textQuery: query, maxResultCount: pageSize };
    if (pageToken) body["pageToken"] = pageToken;

    log.debug({
      event: "places.text_search.request",
      query,
      field_mask: TEXT_SEARCH_FIELDS,
      page_size: pageSize,
      page_token: pageToken ?? null,
    }, "Sending Text Search request");

    const startTs = Date.now();
    const raw = await withRetry(() =>
      placesPost<unknown>("places:searchText", body, TEXT_SEARCH_FIELDS)
    );
    const duration_ms = Date.now() - startTs;
    requestCount++;

    const parsed = TextSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.error({ error: parsed.error.flatten() }, "Failed to parse textSearch response");
      break;
    }

    const pagePlaces = parsed.data.places;

    log.debug({
      event: "places.text_search.response",
      count: pagePlaces.length,
      next_page_token: parsed.data.nextPageToken ?? null,
      duration_ms,
    }, "Received Text Search response");

    requestLog.push({
      request: { query, field_mask: TEXT_SEARCH_FIELDS, page_size: pageSize, page_token: pageToken ?? null },
      response: { place_count: pagePlaces.length, next_page_token: parsed.data.nextPageToken ?? null, duration_ms },
    });

    allPlaces.push(...pagePlaces);
    pageToken = parsed.data.nextPageToken;

    if (allPlaces.length >= maxResultCount) break;

    // Early stop: if a quickDiscardFn is provided and the page discard rate exceeds
    // earlyStopDiscardRatio, stop requesting additional pages for this query.
    if (opts.earlyStopDiscardRatio != null && opts.quickDiscardFn && pagePlaces.length > 0) {
      const discarded = pagePlaces.filter(opts.quickDiscardFn).length;
      const ratio = discarded / pagePlaces.length;
      if (ratio >= opts.earlyStopDiscardRatio) {
        log.debug({
          event: "places.text_search.early_stop",
          query,
          discard_ratio: ratio,
          threshold: opts.earlyStopDiscardRatio,
          page_count: pagePlaces.length,
          discarded,
        }, "Early stop: page discard rate exceeds threshold");
        break;
      }
    }
  } while (pageToken);

  return { places: allPlaces.slice(0, maxResultCount), requestCount, requestLog };
}

// ---- Place Details (selective — only for passed candidates) ------------

export async function fetchPlaceDetails(
  placeId: string
): Promise<PlaceDetailsResult | null> {
  const log = getLogger();
  const startTs = Date.now();

  log.debug({
    event: "places.details.request",
    place_id: placeId,
    field_mask: DETAILS_FIELDS,
  }, "Fetching Place Details");

  try {
    const raw = await withRetry(() =>
      placesGet<unknown>(`places/${placeId}`, DETAILS_FIELDS)
    );
    const duration_ms = Date.now() - startTs;
    const parsed = PlaceDetailsSchema.safeParse(raw);
    if (!parsed.success) {
      log.error({ placeId, error: parsed.error.flatten() }, "Failed to parse Place Details response");
      return null;
    }

    log.debug({
      event: "places.details.response",
      place_id: placeId,
      duration_ms,
      has_photos: (parsed.data.photos?.length ?? 0) > 0,
      has_hours: (parsed.data.regularOpeningHours?.weekdayDescriptions?.length ?? 0) > 0,
      has_reviews: (parsed.data.reviews?.length ?? 0) > 0,
    }, "Received Place Details");

    return parsed.data;
  } catch (err) {
    const duration_ms = Date.now() - startTs;
    log.error({ placeId, duration_ms, err }, "Place Details request failed, lead will persist without enrichment");
    return null;
  }
}

export async function fetchPlaceSummaryForRefresh(placeId: string): Promise<PlaceSummaryResult | null> {
  const log = getLogger();
  try {
    const raw = await withRetry(() =>
      placesGet<unknown>(`places/${placeId}`, REFRESH_SUMMARY_FIELDS)
    );
    const parsed = PlaceSummarySchema.safeParse(raw);
    if (!parsed.success) {
      log.error({ placeId, error: parsed.error.flatten() }, "Failed to parse PlaceSummary response");
      return null;
    }
    return parsed.data;
  } catch (err) {
    log.error({ placeId, err }, "fetchPlaceSummaryForRefresh failed");
    return null;
  }
}

// ---- Public API -------------------------------------------------------

function placesToCandidates(places: PlaceItem[], jobLocation: string): PlaceCandidate[] {
  return places
    .filter((place) => Boolean(place.id))
    .map((place) => {
      const primaryType = place.primaryType ?? null;
      const lat = place.location?.latitude ?? null;
      const lng = place.location?.longitude ?? null;
      const geo_suspect = lat !== null && lng !== null ? !isWithinUruguay(lat, lng) : false;
      const departamento = inferDepartamento(lat, lng, jobLocation);
      return {
        placeId: place.id,
        name: place.displayName?.text ?? "",
        formattedAddress: place.formattedAddress ?? null,
        rating: place.rating ?? null,
        userRatingCount: place.userRatingCount ?? null,
        websiteUri: place.websiteUri ?? null,
        phone: place.internationalPhoneNumber ?? null,
        businessStatus: place.businessStatus ?? null,
        primaryType,
        raw: {
          ...(place as Record<string, unknown>),
          ...(primaryType !== null ? { primary_type: primaryType } : {}),
        },
        lat,
        lng,
        geo_suspect,
        departamento,
      };
    });
}

const EARLY_STOP_DISCARD_RATIO = 0.9;

function makeQuickDiscardFn(minRating: number, minReviews: number): (place: PlaceItem) => boolean {
  return (place) => {
    const rating = place.rating ?? 0;
    const reviews = place.userRatingCount ?? 0;
    return rating < minRating || reviews < minReviews;
  };
}

export async function fetchPlaceCandidates(
  niche: string,
  location: string,
  maxResults: number,
  opts: { minRating?: number; minReviews?: number; earlyStop?: boolean } = {}
): Promise<{ candidates: PlaceCandidate[]; textSearchRequestCount: number; requestLog: TextSearchRequestLog[] }> {
  const log = getLogger();
  const subAreas = getSubAreas(location);
  const searchOpts = opts.earlyStop !== false && (opts.minRating != null || opts.minReviews != null)
    ? {
        earlyStopDiscardRatio: EARLY_STOP_DISCARD_RATIO,
        quickDiscardFn: makeQuickDiscardFn(opts.minRating ?? 0, opts.minReviews ?? 0),
      }
    : {};

  if (subAreas.length === 0) {
    const query = `${niche} en ${location}`;
    log.info({ query, maxResults }, "Starting Places text search (single area)");
    const { places, requestCount, requestLog } = await textSearch(query, maxResults, searchOpts);
    log.info({ count: places.length, requestCount }, "Text search returned places");
    return { candidates: placesToCandidates(places, location), textSearchRequestCount: requestCount, requestLog };
  }

  log.info({ location, subAreas: subAreas.length, maxResults }, "Starting Places text search (sub-areas)");

  const limit = pLimit(3);
  const perSubArea = Math.min(Math.ceil(maxResults / subAreas.length), 20);

  const results = await Promise.all(
    subAreas.map((subArea) =>
      limit(() => textSearch(`${niche} en ${subArea}`, perSubArea, searchOpts))
    )
  );

  const seenIds = new Set<string>();
  const allPlaces: PlaceItem[] = [];
  let totalRequestCount = 0;
  const allRequestLog: TextSearchRequestLog[] = [];

  for (const result of results) {
    totalRequestCount += result.requestCount;
    allRequestLog.push(...result.requestLog);
    for (const place of result.places) {
      if (place.id && !seenIds.has(place.id)) {
        seenIds.add(place.id);
        allPlaces.push(place);
      }
    }
  }

  log.info({ count: allPlaces.length, requestCount: totalRequestCount, subAreas: subAreas.length }, "Sub-area search complete");

  return {
    candidates: placesToCandidates(allPlaces.slice(0, maxResults), location),
    textSearchRequestCount: totalRequestCount,
    requestLog: allRequestLog,
  };
}
