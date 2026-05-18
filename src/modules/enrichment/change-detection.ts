import type { DigitalFootprint } from "../../shared/types.js";

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
  if (footprint.skipped === true) {
    return footprint.heuristic_discovery?.selected.website != null;
  }
  return Boolean(
    footprint.final_url ||
    footprint.attempted_url ||
    footprint.heuristic_discovery?.selected.website?.url
  );
}

function firstContactEmail(footprint: DigitalFootprint | null): string | null {
  const emails = footprint?.contact_emails?.map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
  return emails[0] ?? null;
}

function hasDelivery(footprint: DigitalFootprint | null): boolean {
  return footprint?.skipped !== true && footprint?.inferred_state?.has_delivery.value === true;
}

export function createEnrichmentDiff(
  leadId: string,
  previous: DigitalFootprint | null,
  next: DigitalFootprint
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

  const hadDelivery = hasDelivery(previous);
  const hasDeliveryNow = hasDelivery(next);
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
