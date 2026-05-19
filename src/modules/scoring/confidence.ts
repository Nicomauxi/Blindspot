import type {
  CorroboratingSource,
  DigitalFootprintEnriched,
  EmailQualityAssessment,
  Lead,
} from "../../shared/types.js";
import { classifyUruguayPhone } from "../../shared/phone.js";

type ConfidenceLead = Pick<
  Lead,
  "name" | "address" | "rating" | "phone" | "website" | "whatsapp" |
  "tags" | "digital_footprint" | "canonical_fields" |
  "source_confidence" | "corroborating_sources"
>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function enrichedFootprint(lead: Pick<Lead, "digital_footprint">): DigitalFootprintEnriched | null {
  const fp = lead.digital_footprint;
  if (!fp || fp.skipped) return null;
  return fp;
}

function canonicalFieldValue(
  canonicalFields: Lead["canonical_fields"],
  fieldName: string
): string | null {
  if (!canonicalFields || typeof canonicalFields !== "object") return null;

  const directValue = canonicalFields[fieldName];
  if (typeof directValue === "string") return directValue;
  if (
    directValue &&
    typeof directValue === "object" &&
    "value" in directValue &&
    typeof directValue.value === "string"
  ) {
    return directValue.value;
  }

  return null;
}

function contactEmails(lead: Pick<Lead, "digital_footprint" | "canonical_fields">): string[] {
  const fp = enrichedFootprint(lead);
  const emails = fp?.contact_emails;
  const canonicalEmail = canonicalFieldValue(lead.canonical_fields, "email");
  const footprintEmails = Array.isArray(emails)
    ? emails.filter((e): e is string => typeof e === "string")
    : [];

  return Array.from(new Set([
    ...footprintEmails,
    ...(canonicalEmail ? [canonicalEmail] : []),
  ]));
}

function hasHeuristicWebsite(lead: Pick<Lead, "digital_footprint">): boolean {
  const fp = enrichedFootprint(lead);
  return fp?.heuristic_discovery?.selected?.website != null;
}

function canonicalWebsite(lead: Pick<Lead, "canonical_fields">): string | null {
  return canonicalFieldValue(lead.canonical_fields, "website");
}

function corroboratingCount(lead: Pick<Lead, "corroborating_sources">): number {
  const sources = lead.corroborating_sources as CorroboratingSource[];
  return Array.isArray(sources) ? sources.length : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ─── Coverage fields (8 total) ───────────────────────────────────────────────
//
// Equal-weight binary checks. Each field that is present contributes 1/8.
// website counts if real URL or heuristic match.
// digital_footprint counts only if enriched (not skipped, no fetch_error).

function coverageScore(lead: Pick<
  Lead,
  "name" | "address" | "rating" | "phone" | "website" | "whatsapp" |
  "digital_footprint" | "canonical_fields"
>): number {
  const fp = enrichedFootprint(lead);
  const populated = [
    lead.name.length > 0,
    lead.address !== null,
    lead.phone !== null || canonicalFieldValue(lead.canonical_fields, "phone") !== null,
    lead.rating !== null,
    lead.website !== null || canonicalWebsite(lead) !== null || hasHeuristicWebsite(lead),
    fp !== null && !fp.fetch_error,
    contactEmails(lead).length > 0,
    lead.whatsapp !== null,
  ].filter(Boolean).length;

  return populated / 8;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Data quality score: coverage × source confidence + corroboration bonus.
 * Range: 0.00–1.00 (rounded to 2 decimal places).
 */
export function calculateDataConfidence(lead: Pick<
  Lead,
  "name" | "address" | "rating" | "phone" | "website" | "whatsapp" |
  "digital_footprint" | "canonical_fields" | "source_confidence" | "corroborating_sources"
>): number {
  const coverage = coverageScore(lead);
  const sourceScore = lead.source_confidence ?? 0.5;
  const corroborationBonus = Math.min(0.2, corroboratingCount(lead) * 0.05);
  return round2(Math.min(1, coverage * sourceScore + corroborationBonus));
}

/**
 * Contact reliability score: how confidently can a salesperson reach this lead.
 * Range: 0.00–1.00 (rounded to 2 decimal places).
 *
 * Weights (can accumulate):
 *   phone present            → 0.30
 *   whatsapp present         → 0.30
 *   email-found + emails     → 0.25  (email present without tag → 0.10)
 *   alternative phones       → 0.05 each, max 0.10
 */
function canonicalPhoneValue(canonicalFields: Lead["canonical_fields"]): string | null {
  return canonicalFieldValue(canonicalFields, "phone");
}

function emailAssessments(lead: ConfidenceLead): EmailQualityAssessment[] {
  const fp = enrichedFootprint(lead);
  return fp?.email_quality ?? [];
}

function emailContribution(lead: ConfidenceLead): number {
  const emails = contactEmails(lead);
  if (emails.length === 0) return 0;

  const assessments = emailAssessments(lead);
  if (assessments.length === 0) {
    return lead.tags.includes("email-found") ? 0.25 : 0.1;
  }

  const bestMultiplier = assessments.reduce(
    (max, assessment) => Math.max(max, assessment.reliability_multiplier),
    0
  );

  return 0.25 * bestMultiplier;
}

function mxPenalty(lead: ConfidenceLead): number {
  const assessments = emailAssessments(lead);
  if (assessments.length === 0) return 0;

  const hasValidMx = assessments.some((assessment) => assessment.mx_valid === true);
  const hasOnlyInvalidMx = assessments.every((assessment) => assessment.mx_valid === false);

  return !hasValidMx && hasOnlyInvalidMx ? 0.2 : 0;
}

function hasMobileContact(lead: ConfidenceLead): boolean {
  const fp = enrichedFootprint(lead);
  const directPhones = [
    classifyUruguayPhone(lead.phone),
    classifyUruguayPhone(canonicalPhoneValue(lead.canonical_fields)),
  ];

  return [...directPhones, ...(fp?.phone_classification ?? [])]
    .some((phone) => phone.type === "mobile");
}

export function calculateContactReliability(lead: ConfidenceLead): number {
  let score = 0;

  if (lead.phone !== null || canonicalPhoneValue(lead.canonical_fields) !== null) score += 0.3;
  if (lead.whatsapp !== null) score += 0.3;
  score += emailContribution(lead);

  const fp = enrichedFootprint(lead);
  if (fp) {
    const altPhones = fp.phone_alternatives ?? [];
    score += Math.min(0.1, altPhones.length * 0.05);
  }

  if (hasMobileContact(lead)) score += 0.15;
  score -= mxPenalty(lead);

  return round2(Math.max(0, Math.min(1, score)));
}
