/**
 * Single source of truth for "is this URL a real own website vs a social
 * profile / link-in-bio". Previously this regex was duplicated in
 * social-discover-run.ts, unified-enrich-run.ts and (missing) change-detection.ts,
 * which let an Instagram-as-website count as "has web" in some paths and not
 * others (FS-01).
 */
export const SOCIAL_HOST_RE = /(facebook|instagram|linktr|beacons|wa\.me|whatsapp|tiktok|twitter|x\.com)/i;

/** True when url points to a social profile / link-in-bio host. */
export function isSocialHostUrl(url: string | null | undefined): boolean {
  return !!url && SOCIAL_HOST_RE.test(url);
}

/** True when url is a non-empty, non-social website URL (a business's own site). */
export function isRealWebsiteUrl(url: string | null | undefined): boolean {
  const w = url?.trim();
  return !!w && w.length > 0 && !SOCIAL_HOST_RE.test(w);
}
