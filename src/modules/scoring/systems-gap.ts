import type {
  DigitalFootprintEnriched,
  Lead,
  OperationalSystemsSignal,
} from "../../shared/types.js";
import type { EvaluatedRule } from "./types.js";
import { getSystemsGapConfig, type SystemsGapRule } from "./systems-gap-config.js";

function asEnriched(lead: Lead): DigitalFootprintEnriched | null {
  const footprint = lead.digital_footprint;
  if (!footprint || footprint.skipped === true) return null;
  if (footprint.fetch_error) return null;
  return footprint;
}

function hasAny(values: string[] | undefined): boolean {
  return Array.isArray(values) && values.length > 0;
}

function hasGenericBookingSignal(ops: OperationalSystemsSignal): boolean {
  return (
    hasAny(ops.booking_platforms) ||
    hasAny(ops.class_booking_platforms) ||
    hasAny(ops.reservation_platforms)
  );
}

function hasEvidence(ruleName: string, ops: OperationalSystemsSignal): boolean {
  switch (ruleName) {
    case "booking_system_missing":
      return hasAny(ops.booking_platforms);
    case "whatsapp_business_missing":
      return ops.chat_widget;
    case "online_menu_missing":
      return hasAny(ops.menu_links) || hasAny(ops.menu_keywords);
    case "delivery_platform_missing":
      return hasAny(ops.delivery_platforms);
    case "reservations_missing":
      return hasAny(ops.reservation_platforms);
    case "class_booking_missing":
      return hasAny(ops.class_booking_platforms);
    case "app_missing":
      return hasAny(ops.app_store_links);
    case "online_catalog_missing":
      return hasAny(ops.catalog_keywords);
    case "contact_form_missing":
      return ops.contact_form;
    case "no_booking_any":
      return hasGenericBookingSignal(ops);
    default:
      return false;
  }
}

function ruleApplies(rule: SystemsGapRule, niche: string): boolean {
  return !rule.applies_to || rule.applies_to.includes(niche);
}

export function scoreSystemsGap(lead: Lead): { total: number; breakdown: EvaluatedRule[] } {
  const config = getSystemsGapConfig();
  if (!config.enabled) return { total: 0, breakdown: [] };

  const niche = lead.niche ?? "other";
  if (niche === "other") return { total: 0, breakdown: [] };

  const footprint = asEnriched(lead);
  const ops = footprint?.operational_systems;
  if (!ops) return { total: 0, breakdown: [] };

  const rules = [
    ...(config.rules[niche] ?? []),
    ...(config.rules.all ?? []),
  ].filter((rule) => ruleApplies(rule, niche));
  const matched: EvaluatedRule[] = [];
  const matchedNames = new Set<string>();

  for (const rule of rules) {
    if (rule.requires && !rule.requires.every((name) => matchedNames.has(name))) {
      continue;
    }
    if (rule.requires_none_of?.some((name) => matchedNames.has(name))) {
      continue;
    }
    if (hasEvidence(rule.name, ops)) {
      continue;
    }

    matched.push({ name: rule.name, weight: rule.weight, matched_value: "missing" });
    matchedNames.add(rule.name);
  }

  const total = Math.min(
    matched.reduce((acc, rule) => acc + rule.weight, 0),
    100
  );
  return { total, breakdown: matched };
}
