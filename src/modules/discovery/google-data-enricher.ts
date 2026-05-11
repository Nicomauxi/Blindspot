import { getScoringConfig } from "../scoring/config.js";
import type { PlaceDetailsResult } from "./places.js";

type ReviewItem = NonNullable<PlaceDetailsResult["reviews"]>[number];

function computeHasRecentReviews(reviews: ReviewItem[] | undefined): boolean {
  if (!reviews || reviews.length === 0) return false;
  const recentReviewDays = getScoringConfig().recent_reviews_threshold_days;
  const cutoff = Date.now() - recentReviewDays * 24 * 60 * 60 * 1000;
  return reviews.some((r) => {
    if (!r.publishTime) return false;
    const t = Date.parse(r.publishTime);
    return !Number.isNaN(t) && t >= cutoff;
  });
}

function computeReviewsSummary(reviews: ReviewItem[] | undefined): {
  count: number;
  latest_publish_time: string | null;
} {
  if (!reviews || reviews.length === 0) return { count: 0, latest_publish_time: null };
  let latest: string | null = null;
  for (const r of reviews) {
    if (!r.publishTime) continue;
    if (!latest || r.publishTime > latest) latest = r.publishTime;
  }
  return { count: reviews.length, latest_publish_time: latest };
}

// If details is null/undefined (fetch failed), do NOT enrich.
// Caller persists raw_from_text_search as-is. The 3 derived fields remain
// absent in google_data. The scoring evaluator treats absent fields as
// matched:false without penalizing — correct behavior.
export function enrichWithDetails(
  rawFromTextSearch: Record<string, unknown>,
  details: PlaceDetailsResult
): Record<string, unknown> {
  const photos_count = details.photos?.length ?? 0;
  const has_hours = (details.regularOpeningHours?.weekdayDescriptions?.length ?? 0) > 0;
  const has_recent_reviews = computeHasRecentReviews(details.reviews);
  const reviews_summary = computeReviewsSummary(details.reviews);
  const primaryType =
    typeof rawFromTextSearch["primary_type"] === "string"
      ? rawFromTextSearch["primary_type"]
      : typeof rawFromTextSearch["primaryType"] === "string"
        ? rawFromTextSearch["primaryType"]
        : undefined;

  return {
    ...rawFromTextSearch,
    ...(primaryType !== undefined ? { primary_type: primaryType } : {}),
    photos_count,
    has_hours,
    has_recent_reviews,
    reviews_summary,
  };
}
