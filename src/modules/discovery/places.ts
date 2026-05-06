import { fetch } from "undici";
import { z } from "zod";
import pRetry from "p-retry";
import pLimit from "p-limit";
import { getConfig } from "../../shared/config.js";
import { getLogger } from "../../shared/logger.js";
import type { PlaceCandidate } from "../../shared/types.js";

const PLACES_BASE = "https://places.googleapis.com/v1";
const PLACE_DETAILS_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.businessStatus",
  "places.reviews",
  "places.regularOpeningHours",
  "places.photos",
].join(",");

const DETAIL_FIELDS = PLACE_DETAILS_FIELDS.replace(/^places\./gm, "").replace(
  /,places\./g,
  ","
);

// ---- Zod schemas for Places API responses --------------------------------

const DisplayNameSchema = z.object({
  text: z.string(),
  languageCode: z.string().optional(),
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
});

const TextSearchResponseSchema = z.object({
  places: z.array(PlaceItemSchema).default([]),
  nextPageToken: z.string().optional(),
});

const PlaceDetailSchema = z.object({
  id: z.string(),
  displayName: DisplayNameSchema.optional(),
  formattedAddress: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  websiteUri: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  businessStatus: z.string().optional(),
});

// ---- HTTP helper ----------------------------------------------------------

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
    throw new Error(
      `Places API error ${response.status} on ${path}: ${text}`
    );
  }

  return response.json() as Promise<T>;
}

async function placesGet<T>(
  path: string,
  fieldMask: string
): Promise<T> {
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
    throw new Error(
      `Places API error ${response.status} on ${path}: ${text}`
    );
  }

  return response.json() as Promise<T>;
}

// ---- Retry wrapper -------------------------------------------------------

function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(fn, {
    retries: 3,
    factor: 2,
    minTimeout: 500,
    randomize: true,
    onFailedAttempt: (err) => {
      getLogger().warn(
        { attempt: err.attemptNumber, retriesLeft: err.retriesLeft },
        `Places API request failed, retrying…`
      );
    },
  });
}

// ---- Text Search (returns place IDs + basic fields) ----------------------

export async function textSearch(
  query: string,
  maxResultCount: number
): Promise<z.infer<typeof PlaceItemSchema>[]> {
  type TSearchResponse = z.infer<typeof TextSearchResponseSchema>;
  type PlaceItem = z.infer<typeof PlaceItemSchema>;

  const log = getLogger();
  const allPlaces: PlaceItem[] = [];
  let pageToken: string | undefined;
  const pageSize = Math.min(maxResultCount, 20);

  do {
    const body: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: pageSize,
    };
    if (pageToken) body["pageToken"] = pageToken;

    const raw = await withRetry(() =>
      placesPost<unknown>("places:searchText", body, PLACE_DETAILS_FIELDS)
    );

    const parsed = TextSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.error({ error: parsed.error.flatten() }, "Failed to parse textSearch response");
      break;
    }

    allPlaces.push(...parsed.data.places);
    pageToken = parsed.data.nextPageToken;

    if (allPlaces.length >= maxResultCount) break;
  } while (pageToken);

  return allPlaces.slice(0, maxResultCount);
}

type PlaceItem = z.infer<typeof PlaceItemSchema>;

// ---- Place Details -------------------------------------------------------

const detailLimit = pLimit(5);

async function fetchPlaceDetail(placeId: string): Promise<z.infer<typeof PlaceDetailSchema> | null> {
  const log = getLogger();

  const raw = await withRetry(() =>
    placesGet<unknown>(`places/${placeId}`, DETAIL_FIELDS)
  );

  const parsed = PlaceDetailSchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      { placeId, error: parsed.error.flatten() },
      "Failed to parse place detail"
    );
    return null;
  }

  return parsed.data;
}

// ---- Public API ----------------------------------------------------------

export async function fetchPlaceCandidates(
  niche: string,
  location: string,
  maxResults: number
): Promise<PlaceCandidate[]> {
  const log = getLogger();
  const query = `${niche} en ${location}`;

  log.info({ query, maxResults }, "Starting Places text search");

  const places = await textSearch(query, maxResults);
  log.info({ count: places.length }, "Text search returned places");

  // Enrich with place details in parallel (limited concurrency)
  const candidates = await Promise.all(
    places.map((place) =>
      detailLimit(async () => {
        if (!place.id) return null;

        const detail = await fetchPlaceDetail(place.id);
        const merged = detail ?? place;

        const candidate: PlaceCandidate = {
          placeId: place.id,
          name: merged.displayName?.text ?? place.displayName?.text ?? "",
          formattedAddress: merged.formattedAddress ?? null,
          rating: merged.rating ?? null,
          userRatingCount: merged.userRatingCount ?? null,
          websiteUri: merged.websiteUri ?? null,
          phone: merged.internationalPhoneNumber ?? null,
          businessStatus: merged.businessStatus ?? null,
          raw: merged as Record<string, unknown>,
        };

        return candidate;
      })
    )
  );

  return candidates.filter((c): c is PlaceCandidate => c !== null);
}
