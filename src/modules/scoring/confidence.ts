import type { CorroboratingSource, DigitalFootprintEnriched, Lead } from "../../shared/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function enrichedFootprint(lead: Lead): DigitalFootprintEnriched | null {
  const fp = lead.digital_footprint;
  if (!fp || fp.skipped) return null;
  return fp;
}

function contactEmails(lead: Lead): string[] {
  const fp = enrichedFootprint(lead);
  if (!fp) return [];
  const emails = fp.contact_emails;
  if (!Array.isArray(emails)) return [];
  return emails.filter((e): e is string => typeof e === "string");
}

function hasHeuristicWebsite(lead: Lead): boolean {
  const fp = enrichedFootprint(lead);
  return fp?.heuristic_discovery?.selected?.website != null;
}

function corroboratingCount(lead: Lead): number {
  const sources = lead.corroborating_sources as CorroboratingSource[];
  return Array.isArray(sources) ? sources.length : 0;
}

// ─── Coverage fields (8 total) ───────────────────────────────────────────────
//
// Equal-weight binary checks. Each field that is present contributes 1/8.
// website counts if real URL or heuristic match.
// digital_footprint counts only if enriched (not skipped, no fetch_error).

function coverageScore(lead: Lead): number {
  const fp = enrichedFootprint(lead);
  const populated = [
    lead.name.length > 0,
    lead.address !== null,
    lead.phone !== null,
    lead.rating !== null,
    lead.website !== null || hasHeuristicWebsite(lead),
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
export function calculateDataConfidence(lead: Lead): number {
  const coverage = coverageScore(lead);
  const sourceScore = lead.source_confidence ?? 0.5;
  const corroborationBonus = Math.min(0.2, corroboratingCount(lead) * 0.05);
  return Math.round(Math.min(1, coverage * sourceScore + corroborationBonus) * 100) / 100;
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
export function calculateContactReliability(lead: Lead): number {
  let score = 0;

  if (lead.phone !== null) score += 0.3;
  if (lead.whatsapp !== null) score += 0.3;

  const emails = contactEmails(lead);
  if (emails.length > 0) {
    score += lead.tags.includes("email-found") ? 0.25 : 0.1;
  }

  const fp = enrichedFootprint(lead);
  if (fp) {
    const altPhones = fp.phone_alternatives ?? [];
    score += Math.min(0.1, altPhones.length * 0.05);
  }

  return Math.round(Math.min(1, score) * 100) / 100;
}
