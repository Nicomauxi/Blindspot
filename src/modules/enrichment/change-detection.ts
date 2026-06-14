import type { DigitalFootprint, InferredState } from "../../shared/types.js";
import { isRealWebsiteUrl } from "../../shared/website.js";

export type EnrichmentChangeSignificance = "critical" | "high" | "low";

export interface EnrichmentChange {
  field: string;
  from: unknown;
  to: unknown;
  significance: EnrichmentChangeSignificance;
}

export interface EnrichmentDiff {
  lead_id: string;
  changed_at: string;
  changes: EnrichmentChange[];
}

function hasWebsite(footprint: DigitalFootprint | null): boolean {
  if (!footprint) return false;
  const selectedUrl = footprint.heuristic_discovery?.selected.website?.url ?? null;
  if (footprint.skipped === true) {
    // FS-01: a skipped footprint "has a website" only if a real (non-social) one
    // was discovered — a social profile/link-in-bio does not count.
    return isRealWebsiteUrl(selectedUrl);
  }
  // FS-01: a merely attempted URL (especially a social one whose fetch failed) is
  // NOT evidence of an own website. Require a real, non-social final_url or a real
  // heuristic-selected site, so we never emit a false "consiguió web" alert.
  return isRealWebsiteUrl(footprint.final_url) || isRealWebsiteUrl(selectedUrl);
}

function firstContactEmail(footprint: DigitalFootprint | null): string | null {
  const emails = footprint?.contact_emails?.map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
  return emails[0] ?? null;
}

function hasDelivery(state: InferredState | null): boolean {
  return state?.has_delivery?.value === true;
}

export function createEnrichmentDiff(
  leadId: string,
  previous: DigitalFootprint | null,
  next: DigitalFootprint,
  previousState: InferredState | null = null,
  nextState: InferredState | null = null
): EnrichmentDiff | null {
  const changes: EnrichmentChange[] = [];

  const hadWebsite = hasWebsite(previous);
  const hasWebsiteNow = hasWebsite(next);
  if (!hadWebsite && hasWebsiteNow) {
    changes.push({
      field: "has_website",
      from: false,
      to: true,
      significance: "critical",
    });
  }

  const previousEmail = firstContactEmail(previous);
  const nextEmail = firstContactEmail(next);
  if (previousEmail === null && nextEmail !== null) {
    changes.push({
      field: "contact_email",
      from: null,
      to: nextEmail,
      significance: "critical",
    });
  }

  const previousDeliveryState = previousState ?? ((previous as { inferred_state?: InferredState | null } | null)?.inferred_state ?? null);
  const nextDeliveryState = nextState ?? ((next as { inferred_state?: InferredState | null }).inferred_state ?? null);
  const hadDelivery = hasDelivery(previousDeliveryState);
  const hasDeliveryNow = hasDelivery(nextDeliveryState);
  if (!hadDelivery && hasDeliveryNow) {
    changes.push({
      field: "inferred_state.has_delivery",
      from: false,
      to: true,
      significance: "critical",
    });
  }

  if (changes.length === 0) return null;

  return {
    lead_id: leadId,
    changed_at: new Date().toISOString(),
    changes,
  };
}

export function appendEnrichmentChange(
  diff: EnrichmentDiff | null,
  leadId: string,
  change: EnrichmentChange
): EnrichmentDiff {
  if (diff === null) {
    return {
      lead_id: leadId,
      changed_at: new Date().toISOString(),
      changes: [change],
    };
  }

  return {
    ...diff,
    changes: [...diff.changes, change],
  };
}

export function hasCriticalEnrichmentChange(diff: EnrichmentDiff | null): boolean {
  return diff?.changes.some((change) => change.significance === "critical") ?? false;
}
