import type { Lead } from "../../shared/types.js";
import type { ContactTier } from "./types.js";
import { getLeadInferredState, inferredBool } from "./state.js";

export const CONTACTABLE_TIERS = new Set<ContactTier>(["A", "B", "C"]);

export function canonicalFieldValue(
  canonicalFields: Lead["canonical_fields"],
  field: string
): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;
  const raw = canonicalFields[field];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof raw.value === "string") {
    return raw.value;
  }
  return null;
}

export function getCanonicalPhone(lead: Lead): string | null {
  return canonicalFieldValue(lead.canonical_fields, "phone");
}

export function getEmailCount(lead: Lead): number {
  const direct = canonicalFieldValue(lead.canonical_fields, "email");
  const fromFootprint = Array.isArray(lead.digital_footprint?.contact_emails)
    ? lead.digital_footprint.contact_emails.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  const emails = new Set<string>();
  if (direct) emails.add(direct);
  for (const email of fromFootprint) emails.add(email);
  return emails.size;
}

export function computeContactTier(lead: Lead): ContactTier {
  if (getEmailCount(lead) > 0) return "A";
  if (lead.whatsapp != null) return "B";
  if (lead.phone != null || getCanonicalPhone(lead) != null) return "C";
  if (lead.address != null) return "D";
  return "X";
}

export function hasKnownDigitalAssets(lead: Lead): boolean {
  if (lead.website != null) return true;
  const tags = new Set(lead.tags);
  const digitalTags = [
    "website-heuristic",
    "web-only-no-social",
    "fb-heuristic",
    "fb-confirmed",
    "fb-only-presence",
    "ig-heuristic",
    "ig-confirmed",
    "ig-only-presence",
    "social-link-only",
    "whatsapp-confirmed",
    "whatsapp-derived",
    "chat-widget",
  ];
  if (digitalTags.some((tag) => tags.has(tag))) return true;

  const fp = lead.digital_footprint;
  if (fp && !fp.skipped) {
    if (fp.social_links?.count && fp.social_links.count > 0) return true;
    const ops = fp.operational_systems;
    if (ops) {
      const arrays = [
        ops.booking_platforms,
        ops.reservation_platforms,
        ops.delivery_platforms,
        ops.menu_links,
        ops.class_booking_platforms,
        ops.app_store_links,
        ops.ecommerce_platforms,
        ops.catalog_keywords,
      ];
      if (arrays.some((items) => Array.isArray(items) && items.length > 0)) return true;
    }
  }

  const state = getLeadInferredState(lead);
  if (!state) return false;

  return (
    inferredBool(state, "has_delivery") ||
    inferredBool(state, "has_pos") ||
    inferredBool(state, "has_reservations") ||
    inferredBool(state, "has_ecommerce") ||
    inferredBool(state, "has_online_catalog") ||
    state.digitalization_level === "intermediate" ||
    state.digitalization_level === "advanced"
  );
}
