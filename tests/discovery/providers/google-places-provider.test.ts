import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlaceCandidate } from "../../../src/shared/types.js";

vi.mock("../../../src/modules/discovery/places.js", () => ({
  fetchPlaceCandidates: vi.fn(),
}));

import { fetchPlaceCandidates } from "../../../src/modules/discovery/places.js";
import { GooglePlacesProvider } from "../../../src/modules/discovery/providers/google-places.js";

const mockFetchPlaceCandidates = vi.mocked(fetchPlaceCandidates);

const SAMPLE_CANDIDATE: PlaceCandidate = {
  placeId: "ChIJplace1",
  name: "Restaurante El Sol",
  formattedAddress: "Colonia 1234, Montevideo",
  rating: 4.6,
  userRatingCount: 42,
  websiteUri: "https://elsol.com.uy",
  phone: "+59898123456",
  businessStatus: "OPERATIONAL",
  primaryType: "restaurant",
  raw: { id: "ChIJplace1", primary_type: "restaurant" },
};

function makeStatsResult(candidates: PlaceCandidate[]) {
  return {
    candidates,
    textSearchRequestCount: 1,
    requestLog: [],
  };
}

describe("GooglePlacesProvider — identity", () => {
  it("reports source as google_places", () => {
    const provider = new GooglePlacesProvider();
    expect(provider.source).toBe("google_places");
  });

  it("reports sourceConfidence as 0.9", () => {
    const provider = new GooglePlacesProvider();
    expect(provider.sourceConfidence).toBe(0.9);
  });
});

describe("GooglePlacesProvider.discover — field mapping", () => {
  beforeEach(() => mockFetchPlaceCandidates.mockClear());

  it("maps placeId to external_id", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const results = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(results[0]!.external_id).toBe("ChIJplace1");
  });

  it("sets source and source_confidence on every candidate", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const results = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(results[0]!.source).toBe("google_places");
    expect(results[0]!.source_confidence).toBe(0.9);
  });

  it("maps name, address, phone, website correctly", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const [r] = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(r!.name).toBe("Restaurante El Sol");
    expect(r!.address).toBe("Colonia 1234, Montevideo");
    expect(r!.phone).toBe("+59898123456");
    expect(r!.website).toBe("https://elsol.com.uy");
  });

  it("sets email, latitude, longitude to null — not provided by Google Places text search", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const [r] = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(r!.email).toBeNull();
    expect(r!.latitude).toBeNull();
    expect(r!.longitude).toBeNull();
  });

  it("sets niche from query", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const [r] = await new GooglePlacesProvider().discover({ niche: "gym", location: "Salto" });
    expect(r!.niche).toBe("gym");
  });

  it("includes rating, userRatingCount, businessStatus, primaryType in raw", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE]));
    const [r] = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(r!.raw["rating"]).toBe(4.6);
    expect(r!.raw["userRatingCount"]).toBe(42);
    expect(r!.raw["businessStatus"]).toBe("OPERATIONAL");
    expect(r!.raw["primaryType"]).toBe("restaurant");
  });

  it("returns empty array when no candidates", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([]));
    const results = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Durazno" });
    expect(results).toHaveLength(0);
  });

  it("passes maxResults from query to fetchPlaceCandidates", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([]));
    await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Minas", maxResults: 5 });
    expect(mockFetchPlaceCandidates).toHaveBeenCalledWith("restaurant", "Minas", 5);
  });

  it("defaults maxResults to 20 when not specified", async () => {
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([]));
    await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Colonia" });
    expect(mockFetchPlaceCandidates).toHaveBeenCalledWith("restaurant", "Colonia", 20);
  });

  it("maps multiple candidates preserving order", async () => {
    const c2 = { ...SAMPLE_CANDIDATE, placeId: "ChIJplace2", name: "La Bodeguita" };
    mockFetchPlaceCandidates.mockResolvedValueOnce(makeStatsResult([SAMPLE_CANDIDATE, c2]));
    const results = await new GooglePlacesProvider().discover({ niche: "restaurant", location: "Montevideo" });
    expect(results).toHaveLength(2);
    expect(results[0]!.external_id).toBe("ChIJplace1");
    expect(results[1]!.external_id).toBe("ChIJplace2");
  });
});
