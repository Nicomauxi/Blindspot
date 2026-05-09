import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetch as undiciFetch } from "undici";

vi.mock("undici", () => ({ fetch: vi.fn() }));

vi.mock("../../src/shared/config.js", () => ({
  getConfig: () => ({ GOOGLE_PLACES_API_KEY: "test-api-key-for-places-tests" }),
}));

const debugCalls: unknown[][] = [];
vi.mock("../../src/shared/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn((...args: unknown[]) => { debugCalls.push(args); }),
  }),
}));

import {
  textSearch,
  fetchPlaceDetails,
  TEXT_SEARCH_FIELDS,
  DETAILS_FIELDS,
} from "../../src/modules/discovery/places.js";

const mockFetch = vi.mocked(undiciFetch);

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as ReturnType<typeof fetch>;
}

const SAMPLE_PLACE = {
  id: "place1",
  displayName: { text: "Test Business", languageCode: "es" },
  formattedAddress: "123 Test St",
  rating: 4.5,
  userRatingCount: 25,
  websiteUri: "https://example.com",
  internationalPhoneNumber: "+5491234567890",
  businessStatus: "OPERATIONAL",
};

describe("textSearch — HTTP request count", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    debugCalls.length = 0;
  });

  it("makes exactly 1 HTTP request for max-results=10", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ places: [SAMPLE_PLACE] }));
    const result = await textSearch("peluquería en Montevideo", 10);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.requestCount).toBe(1);
    expect(result.places).toHaveLength(1);
  });

  it("makes exactly 2 HTTP requests for max-results=30 when first page is full (20 items)", async () => {
    const twentyPlaces = Array.from({ length: 20 }, (_, i) => ({ ...SAMPLE_PLACE, id: `place${i}` }));
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ places: twentyPlaces, nextPageToken: "page2-token" }))
      .mockResolvedValueOnce(makeOkResponse({ places: [SAMPLE_PLACE] }));
    const result = await textSearch("peluquería en Montevideo", 30);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.requestCount).toBe(2);
  });
});

describe("TEXT_SEARCH_FIELDS — no Atmosphere fields", () => {
  it("does not include photos in Text Search field mask", () => {
    expect(TEXT_SEARCH_FIELDS).not.toContain("photo");
  });

  it("does not include reviews in Text Search field mask", () => {
    expect(TEXT_SEARCH_FIELDS).not.toContain("review");
  });

  it("does not include openingHours in Text Search field mask", () => {
    expect(TEXT_SEARCH_FIELDS).not.toContain("openingHours");
  });
});

describe("fetchPlaceDetails — requests and parsing", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    debugCalls.length = 0;
  });

  it("uses GET to places/<placeId> with DETAILS_FIELDS mask", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await fetchPlaceDetails("ChIJplace123");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain("places/ChIJplace123");
    expect((options as RequestInit).method).toBe("GET");
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toBe(DETAILS_FIELDS);
  });

  it("returns parsed PlaceDetailsResult on success", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        photos: [{ name: "photo1" }, { name: "photo2" }],
        regularOpeningHours: { weekdayDescriptions: ["Lun: 9:00–18:00"] },
        reviews: [{ publishTime: new Date().toISOString(), rating: 5 }],
      })
    );
    const result = await fetchPlaceDetails("ChIJplace123");
    expect(result).not.toBeNull();
    expect(result!.photos).toHaveLength(2);
    expect(result!.regularOpeningHours?.weekdayDescriptions).toHaveLength(1);
    expect(result!.reviews).toHaveLength(1);
  });

  it("returns null and does NOT throw on 5xx error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as ReturnType<typeof fetch>);
    await expect(fetchPlaceDetails("ChIJplace123")).resolves.toBeNull();
  });

  it("never includes API key value in debug logs", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await fetchPlaceDetails("ChIJplace123");
    const allLogs = JSON.stringify(debugCalls);
    expect(allLogs).not.toContain("test-api-key-for-places-tests");
  });
});
