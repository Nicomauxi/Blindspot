import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";
import { fetchPlaceCandidates } from "../places.js";

const SOURCE: DiscoverySource = "google_places";
const SOURCE_CONFIDENCE = 0.9;

export class GooglePlacesProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const { candidates } = await fetchPlaceCandidates(
      query.niche,
      query.location,
      query.maxResults ?? 20
    );
    return candidates.map((c) => ({
      source: SOURCE,
      external_id: c.placeId,
      source_confidence: SOURCE_CONFIDENCE,
      name: c.name,
      address: c.formattedAddress,
      phone: c.phone,
      website: c.websiteUri,
      email: null,
      latitude: null,
      longitude: null,
      niche: query.niche,
      raw: {
        ...c.raw,
        rating: c.rating,
        userRatingCount: c.userRatingCount,
        businessStatus: c.businessStatus,
        primaryType: c.primaryType,
      },
    }));
  }
}
