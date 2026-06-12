import type { DigitalFootprintEnriched, Lead } from "../../shared/types.js";
import { calculateContactReliability } from "./confidence.js";
import { getScoringConfig } from "./config.js";
import type { ContactScoreSignal, ContactTier } from "./types.js";
import { getLeadInferredState, inferredBool } from "./state.js";
import { classifyUruguayPhone } from "../../shared/phone.js";

export const CONTACTABLE_TIERS = new Set<ContactTier>(["A", "B", "C"]);

/**
 * El tier A es el target comercial top. Un lead con contacto rico pero sin relevancia
 * comercial NO debe colapsar a A (F3.1). Se excluyen:
 *  - verticales B2B (industrial/otro de F1.4): fuera del ICP comercial.
 *  - niche no reconocido ('other'/null): sin relevancia de rubro confirmada.
 */
export function qualifiesForCommercialTierA(lead: Lead): boolean {
  const tags = lead.tags ?? [];
  if (tags.includes("vertical-industrial") || tags.includes("vertical-otro")) return false;
  if (!lead.niche || lead.niche === "other") return false;
  return true;
}

export interface ContactProfile {
  score: number;
  tier: ContactTier;
  signals: ContactScoreSignal[];
}

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

function getEnrichedFootprint(lead: Lead): DigitalFootprintEnriched | null {
  const fp = lead.digital_footprint;
  if (!fp || fp.skipped) return null;
  return fp;
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

function pushSignal(signals: ContactScoreSignal[], name: string, weight: number, value: string | number | boolean | null) {
  if (weight <= 0) return;
  signals.push({ name, weight, value });
}

function hasDirectWhatsapp(lead: Lead, fp: DigitalFootprintEnriched | null): boolean {
  if (lead.whatsapp != null) return true;
  if (lead.tags.includes("whatsapp-confirmed")) return true;
  return Boolean(fp?.whatsapp?.present && (fp.whatsapp.numbers?.length ?? 0) > 0);
}

function hasDerivedWhatsapp(lead: Lead, fp: DigitalFootprintEnriched | null): boolean {
  if (lead.tags.includes("whatsapp-derived")) return true;
  return Boolean(fp?.operational_systems?.whatsapp_web_link);
}

function socialDmChannels(fp: DigitalFootprintEnriched | null): string[] {
  if (!fp?.social_links) return [];
  return [fp.social_links.facebook, fp.social_links.instagram, fp.social_links.tiktok].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function resolveTier(score: number, thresholds: Record<Exclude<ContactTier, "X">, number>): ContactTier {
  if (score >= thresholds.A) return "A";
  if (score >= thresholds.B) return "B";
  if (score >= thresholds.C) return "C";
  if (score >= thresholds.D) return "D";
  return "X";
}

export function resolveContactReliability(lead: Lead): number {
  return lead.contact_reliability_score ?? calculateContactReliability(lead);
}

export function computeContactProfile(lead: Lead): ContactProfile {
  const config = getScoringConfig().commercial_score.accessibility.contact_score;
  const fp = getEnrichedFootprint(lead);
  const weights = config.weights;
  const resolvedContactReliability = resolveContactReliability(lead);
  const signals: ContactScoreSignal[] = [];
  let score = 0;

  const emailCount = getEmailCount(lead);
  if (emailCount > 0) {
    score += weights.email;
    pushSignal(signals, "email", weights.email, emailCount);

    const extraEmailBonus = Math.min(2, emailCount - 1) * weights.extra_email;
    if (extraEmailBonus > 0) {
      score += extraEmailBonus;
      pushSignal(signals, "extra_email", extraEmailBonus, emailCount - 1);
    }
  }

  const directWhatsapp = hasDirectWhatsapp(lead, fp);
  const derivedWhatsapp = !directWhatsapp && hasDerivedWhatsapp(lead, fp);
  if (directWhatsapp) {
    score += weights.whatsapp_direct;
    pushSignal(signals, "whatsapp_direct", weights.whatsapp_direct, true);
  } else if (derivedWhatsapp) {
    score += weights.whatsapp_derived;
    pushSignal(signals, "whatsapp_derived", weights.whatsapp_derived, true);
  }

  const phoneValue = getCanonicalPhone(lead) ?? lead.phone;
  if (phoneValue != null) {
    // F3.3: el móvil (señal del dueño) pesa más que el fijo (gestor/oficina, típico DEI).
    // Un fijo conocido usa phone_landline; móvil o desconocido usan el peso base.
    const isLandline =
      classifyUruguayPhone(phoneValue).type === "landline" || lead.tags.includes("landline-phone");
    const phoneWeight = isLandline ? weights.phone_landline ?? weights.phone : weights.phone;
    score += phoneWeight;
    pushSignal(signals, isLandline ? "phone_landline" : "phone", phoneWeight, true);
  }

  if (fp?.phone_confirmed) {
    score += weights.phone_confirmed_bonus;
    pushSignal(signals, "phone_confirmed_bonus", weights.phone_confirmed_bonus, true);
  }

  if (lead.address != null) {
    score += weights.address;
    pushSignal(signals, "address", weights.address, true);
  }

  if (lead.website != null) {
    score += weights.website;
    pushSignal(signals, "website", weights.website, true);
  }

  if (fp?.operational_systems?.contact_form) {
    score += weights.contact_form;
    pushSignal(signals, "contact_form", weights.contact_form, true);
  }

  const socialChannels = socialDmChannels(fp);
  if (socialChannels.length > 0) {
    const socialWeight = Math.min(2, socialChannels.length) * weights.social_dm_channel;
    score += socialWeight;
    pushSignal(signals, "social_dm_channel", socialWeight, socialChannels.length);
  }

  if (!directWhatsapp && fp?.operational_systems?.whatsapp_web_link) {
    score += weights.whatsapp_web_link;
    pushSignal(signals, "whatsapp_web_link", weights.whatsapp_web_link, true);
  }

  const channelCount = [
    emailCount > 0,
    directWhatsapp || derivedWhatsapp,
    phoneValue != null,
    lead.website != null || Boolean(fp?.operational_systems?.contact_form),
    socialChannels.length > 0,
  ].filter(Boolean).length;

  const multichannelBonus = Math.min(2, Math.max(0, channelCount - 1)) * weights.multi_channel_bonus;
  if (multichannelBonus > 0) {
    score += multichannelBonus;
    pushSignal(signals, "multi_channel_bonus", multichannelBonus, channelCount);
  }

  if (resolvedContactReliability >= 0.85) {
    score += weights.high_confidence_bonus;
    pushSignal(signals, "high_confidence_bonus", weights.high_confidence_bonus, resolvedContactReliability);
  }

  const clampedScore = Math.max(0, Math.min(config.cap, score));

  let tier = resolveTier(clampedScore, config.thresholds);
  // F3.1: degradar A→B si el lead no es target comercial (vertical B2B o niche no reconocido).
  if (tier === "A" && !qualifiesForCommercialTierA(lead)) {
    tier = "B";
  }

  return {
    score: clampedScore,
    tier,
    signals,
  };
}

export function computeContactTier(lead: Lead): ContactTier {
  return computeContactProfile(lead).tier;
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
