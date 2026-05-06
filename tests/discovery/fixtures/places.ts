import type { PlaceCandidate } from "../../../src/shared/types.js";

export const candidateWithSocialWeb: PlaceCandidate = {
  placeId: "place_001",
  name: "Peluquería La Paloma",
  formattedAddress: "Av. 18 de Julio 1234, Montevideo",
  rating: 4.7,
  userRatingCount: 35,
  websiteUri: "https://www.facebook.com/peluqueriapaloma",
  phone: "+59899123456",
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateWithNoWeb: PlaceCandidate = {
  placeId: "place_002",
  name: "Restaurante Don Pepe",
  formattedAddress: "Bulevar Artigas 500, Montevideo",
  rating: 4.5,
  userRatingCount: 28,
  websiteUri: null,
  phone: "+59899654321",
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateHighReviewsNoWeb: PlaceCandidate = {
  placeId: "place_003",
  name: "Ferretería Central",
  formattedAddress: "25 de Mayo 300, Montevideo",
  rating: 4.2,
  userRatingCount: 250,
  websiteUri: null,
  phone: "+59899111222",
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateHighReviewsWithWeb: PlaceCandidate = {
  placeId: "place_004",
  name: "Hotel Esplendor",
  formattedAddress: "Plaza Independencia 1, Montevideo",
  rating: 4.6,
  userRatingCount: 1200,
  websiteUri: "https://www.hotelesplendor.com",
  phone: "+59892345678",
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateLowRating: PlaceCandidate = {
  placeId: "place_005",
  name: "Almacén El Rincón",
  formattedAddress: "Calle X 100",
  rating: 3.9,
  userRatingCount: 20,
  websiteUri: null,
  phone: null,
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateTooFewReviews: PlaceCandidate = {
  placeId: "place_006",
  name: "Kiosco Nuevo",
  formattedAddress: "Calle Y 5",
  rating: 4.8,
  userRatingCount: 5,
  websiteUri: null,
  phone: null,
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateWithRealWeb: PlaceCandidate = {
  placeId: "place_007",
  name: "Consultora Tech",
  formattedAddress: "Rincón 477",
  rating: 4.4,
  userRatingCount: 30,
  websiteUri: "https://www.consultora.com.uy",
  phone: "+598291234567",
  businessStatus: "OPERATIONAL",
  raw: {},
};

export const candidateProfileABorderline: PlaceCandidate = {
  placeId: "place_008",
  name: "Spa Tranquilidad",
  formattedAddress: "Pocitos 999",
  rating: 4.3,
  userRatingCount: 10,
  websiteUri: null,
  phone: "+598291112233",
  businessStatus: "OPERATIONAL",
  raw: {},
};
