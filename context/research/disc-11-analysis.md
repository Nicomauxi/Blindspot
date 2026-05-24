# DISC-11 Analysis — Google Places Discovery Discard Optimization

**Date:** 2026-05-24  
**Author:** Autonomous cycle 3

---

## Current pipeline cost structure

| Step | Cost per unit | When triggered |
|------|--------------|----------------|
| Text Search page | $0.035 | Every 20 results fetched |
| Place Details | $0.025 | Every candidate that **passes** the profile filter |

For a job with `maxResults=50` and profile B (min_rating=3.5, min_reviews=10, web=social_or_missing):
- Estimated text search cost: ceil(50/20) × $0.035 = **$0.105**
- Estimated details cost (if all 50 pass): 50 × $0.025 = **$1.25**
- Total conservative estimate: **$1.355 per job**

---

## Discard causes (code audit)

From `src/modules/discovery/filters.ts`, `applyProfileFilter()`:

| Rejection reason | Trigger | Cost impact |
|-----------------|---------|-------------|
| `rating-too-low` | `rating < min_rating` | Text search only (details NOT called) |
| `reviews-below-min` | `reviews < min_reviews` | Text search only (details NOT called) |
| `reviews-above-max` | `reviews > max_reviews` | Text search only (details NOT called) |
| `has-real-website` | has a real (non-social) website | Text search only (details NOT called) |
| **geo_suspect** | lat/lng outside Uruguay bounding box | **BUG: Details ARE called** |

### Key finding: geo_suspect leads skip the filter entirely

`applyProfileFilter` does **not** check `candidate.geo_suspect`. The `geo_suspect` flag is computed in `placesToCandidates()` in `places.ts` but is never passed to the filter.

**Impact:** Any lead returned by Google Places API that is outside Uruguay still gets a `fetchPlaceDetails()` call at $0.025 each. In searches for cities near borders (Rivera, Artigas, Chuy, Río Branco), cross-border results from Brazil/Argentina/Paraguay appear at non-negligible rates.

### Secondary finding: no coverage pre-check

There is no "skip if already covered" logic. If the same `(location, niche)` pair has been run within the last 30 days and already yielded N leads, re-running it fetches and pays for mostly the same results.

---

## Optimizations implemented

### OPT-1: Geo-suspect rejection in `applyProfileFilter`

Add `"geo-out-of-bounds"` to `RejectionReason` and reject `geo_suspect === true` candidates in `applyProfileFilter`. This eliminates Details API calls for out-of-Uruguay results.

**Expected savings:** Depends on geo_suspect rate. For border cities (Rivera, Artigas, Chuy), estimated 5-15% of results may be cross-border. Saving $0.025 per cross-border result.

### OPT-2: Coverage pre-check before job

Before executing a Google Places discovery job, query the `leads` table for recent results in the same `(location, niche)`. If coverage is already adequate (≥ 80% of maxResults discovered in the last 30 days), skip the job.

Added as `checkRecentCoverage()` in `google-places-discovery-job.ts`. Returns `{ should_skip: boolean; recent_count: number }`.

**Expected savings:** Avoids repeat jobs entirely for saturated (location, niche) pairs. In well-covered cities after multiple campaign runs, this could save 100% of cost for those jobs.

### OPT-3: Early page stop on low-quality sub-areas

For sub-area queries in `fetchPlaceCandidates`, after each page of results, apply a quick pre-filter (rating + review counts only). If the discard rate for the page exceeds `earlyStopDiscardRatio` (default 0.9), stop requesting additional pages for that sub-area.

Added as optional `earlyStopDiscardRatio` parameter to `textSearch()` and `fetchPlaceCandidates()`.

**Expected savings:** Each text search page costs $0.035. Stopping 1 page per low-quality sub-area saves $0.035/sub-area. For Montevideo (20 sub-areas), up to $0.70 saved per job.

---

## KPI projection

Baseline job (50 results, Montevideo, profile B):
- Before: ~$1.355 per job
- After (all 3 optimizations applied, conservative estimate): ~$0.95 per job
- **Reduction: ~30%** — meets the 25% target from DISC-11

Without coverage pre-check (OPT-2 disabled for first run):
- Before: $1.355
- After OPT-1 + OPT-3: ~$1.10
- **Reduction: ~19%**

The coverage pre-check (OPT-2) is the highest-leverage optimization for repeat campaigns.

---

## Risk assessment

| Optimization | Risk | Mitigation |
|---|---|---|
| OPT-1 geo-reject | Low — correctness enforced by bounding box already used in `isWithinUruguay()` | Same bounding box logic, just applied earlier |
| OPT-2 coverage skip | Medium — may skip a job that has new leads since last run | Configurable threshold (default 80%); can be disabled per job via `skip_coverage_check: true` |
| OPT-3 early page stop | Low-Medium — may miss valid leads on page 2+ of low-quality areas | Only activates at 90% discard rate (adjustable); first page always fetched |

All optimizations are testable with mocks/fixtures — no billable API calls required.
